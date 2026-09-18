const assert = require('node:assert/strict');
const test = require('node:test');
const { createWebhookProcessor } = require('../src/webhook/processor');

test('initializes a missing repository graph from the pushed commit', async () => {
  const calls = [];
  const store = {
    async hasGraph() { return false; },
    async saveGraph(graph, metadata) { calls.push({ operation: 'saveGraph', graph, metadata }); },
    async applyChanges() { calls.push({ operation: 'applyChanges' }); },
    async close() {},
  };
  const githubClient = {
    async getAllSourceFiles(options) {
      calls.push({ operation: 'getAllSourceFiles', options });
      return [{ path: 'src/index.js', source: 'export function index() {}' }];
    },
    async getChangedFiles() {
      calls.push({ operation: 'getChangedFiles' });
      return [];
    },
  };
  const processor = createWebhookProcessor({
    githubClient,
    storeFactory: () => store,
    deliveryStore: new MapDeliveryStore(),
  });

  await processor.enqueue({
    deliveryId: 'initial-index-1',
    payload: {
      installationId: 'install-1',
      repositoryId: 'repo-1',
      fullName: 'owner/repo',
      owner: 'owner',
      repo: 'repo',
      commitSha: 'commit-1',
      changedPaths: [],
      removedPaths: [],
    },
  });

  assert.deepEqual(calls.map((call) => call.operation), ['getAllSourceFiles', 'saveGraph']);
  assert.equal(calls[1].metadata.commitSha, 'commit-1');
  assert.equal(calls[1].metadata.githubRepositoryId, 'repo-1');
});

class MapDeliveryStore {
  constructor() { this.ids = new Set(); }
  async begin(id) { if (this.ids.has(id)) return false; this.ids.add(id); return true; }
  async complete() {}
  async fail() {}
  async recordRepository() {}
}
