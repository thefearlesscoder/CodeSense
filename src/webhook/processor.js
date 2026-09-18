const { GitHubClient, GitHubAppClient } = require('./github-client');
const { DeliveryStore, Neo4jDeliveryStore } = require('./delivery-store');
const { javascriptAdapter } = require('../languages/javascript');
const { Neo4jStore } = require('../storage/neo4j-store');
const { buildGraphFromParsed } = require('../graph-builder');

function createWebhookProcessor({ githubClient, deliveryStore, storeFactory } = {}) {
  const client = githubClient || (process.env.GITHUB_APP_ID
    ? GitHubAppClient.fromEnvironment()
    : new GitHubClient({ token: process.env.GITHUB_TOKEN }));
  const deliveries = deliveryStore || (process.env.NEO4J_URI ? new Neo4jDeliveryStore() : new DeliveryStore());
  const createStore = storeFactory || ((repoId) => Neo4jStore.fromEnvironment({ repoId }));

  return {
    async enqueue({ deliveryId, payload }) {
      if (!(await deliveries.begin(deliveryId))) return { duplicate: true };
      if (!payload.installationId) throw new Error('Push payload is missing installation.id');
      const repoId = `github:${payload.repositoryId}`;
      const store = createStore(repoId);
      try {
        await deliveries.recordRepository({
          installationId: payload.installationId,
          repositoryId: payload.repositoryId,
          fullName: payload.fullName,
        });
        if (!(await store.hasGraph())) {
          const allFiles = await client.getAllSourceFiles({
            installationId: payload.installationId,
            owner: payload.owner,
            repo: payload.repo,
            ref: payload.commitSha,
          });
          const allParsedFiles = allFiles.map(({ path, source }) => javascriptAdapter.parse({ source, relativePath: path }));
          const graph = buildGraphFromParsed(payload.fullName, new Set(allParsedFiles.map((file) => file.relativePath)), allParsedFiles);
          await store.saveGraph(graph, {
            commitSha: payload.commitSha,
            githubRepositoryId: payload.repositoryId,
            installationId: payload.installationId,
          });
          await deliveries.complete(deliveryId);
          console.log(JSON.stringify({ deliveryId, repository: payload.fullName, commitSha: payload.commitSha, changedFiles: allFiles.length, removedFiles: 0, mode: 'initial', status: 'completed' }));
          return { duplicate: false, initial: true };
        }
        const changedFiles = await client.getChangedFiles({
          installationId: payload.installationId,
          owner: payload.owner,
          repo: payload.repo,
          ref: payload.commitSha,
          paths: payload.changedPaths,
        });
        const parsedFiles = changedFiles.map(({ path, source }) => javascriptAdapter.parse({ source, relativePath: path }));
        await store.applyChanges({
          repoName: payload.fullName,
          commitSha: payload.commitSha,
          githubRepositoryId: payload.repositoryId,
          installationId: payload.installationId,
          parsedFiles,
          removedPaths: payload.removedPaths,
        });
        await deliveries.complete(deliveryId);
        console.log(JSON.stringify({ deliveryId, repository: payload.fullName, commitSha: payload.commitSha, changedFiles: changedFiles.length, removedFiles: payload.removedPaths.length, status: 'completed' }));
        return { duplicate: false };
      } catch (error) {
        deliveries.fail(deliveryId);
        throw error;
      } finally {
        await store.close();
      }
    },
    async handleLifecycle({ event, body }) {
      const payload = JSON.parse(body.toString('utf8'));
      if (event === 'installation') {
        const installationId = String(payload.installation?.id);
        if (!installationId || installationId === 'undefined') throw new Error('Installation event is missing installation.id');
        await deliveries.recordInstallation({
          installationId,
          active: payload.action !== 'deleted',
          account: payload.installation.account?.login || payload.installation.account?.slug || null,
        });
      }
      if (event === 'installation_repositories') {
        const installationId = String(payload.installation?.id);
        if (!installationId || installationId === 'undefined') throw new Error('Installation repositories event is missing installation.id');
        await deliveries.recordInstallation({ installationId, active: true, account: null });
        for (const repository of payload.repositories_added || []) {
          await deliveries.recordRepository({ installationId, repositoryId: String(repository.id), fullName: repository.full_name });
        }
        for (const repository of payload.repositories_removed || []) {
          await deliveries.revokeRepository({ installationId, repositoryId: String(repository.id) });
        }
      }
    },
  };
}

module.exports = { createWebhookProcessor };