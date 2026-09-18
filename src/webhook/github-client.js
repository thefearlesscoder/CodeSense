const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const fs = require('node:fs');

class GitHubClient {
  constructor({ token, octokit = new Octokit({ auth: token }) }) {
    if (!token && !octokit) throw new Error('GITHUB_TOKEN is required');
    this.octokit = octokit;
  }

  async getChangedFiles({ owner, repo, ref, paths }) {
    const files = [];
    for (const path of paths) {
      const response = await this.octokit.repos.getContent({ owner, repo, path, ref });
      if (Array.isArray(response.data) || response.data.type !== 'file') continue;
      files.push({ path, source: Buffer.from(response.data.content, 'base64').toString('utf8') });
    }
    return files;
  }

  async getAllSourceFiles({ owner, repo, ref, extensions = ['.js', '.mjs', '.cjs', '.jsx'] }) {
    const tree = await this.octokit.git.getTree({ owner, repo, tree_sha: ref, recursive: 'true' });
    const paths = tree.data.tree
      .filter((item) => item.type === 'blob' && extensions.some((extension) => item.path.endsWith(extension)))
      .map((item) => item.path);
    return this.getChangedFiles({ owner, repo, ref, paths });
  }
}

class GitHubAppClient {
  constructor({ appId, privateKey, privateKeyPath, auth = createAppAuth }) {
    if (!appId || (!privateKey && !privateKeyPath)) {
      throw new Error('GitHub App requires GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH or GITHUB_APP_PRIVATE_KEY');
    }
    this.appId = appId;
    this.privateKey = privateKey || fs.readFileSync(privateKeyPath, 'utf8');
    this.auth = auth;
  }

  static fromEnvironment() {
    return new GitHubAppClient({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      privateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
    });
  }

  async getChangedFiles({ installationId, owner, repo, ref, paths }) {
    const { token } = await this.auth({
      appId: this.appId,
      privateKey: this.privateKey,
      installationId,
      type: 'installation',
    });
    return new GitHubClient({ token }).getChangedFiles({ owner, repo, ref, paths });
  }

  async getAllSourceFiles({ installationId, owner, repo, ref }) {
    const { token } = await this.auth({
      appId: this.appId,
      privateKey: this.privateKey,
      installationId,
      type: 'installation',
    });
    return new GitHubClient({ token }).getAllSourceFiles({ owner, repo, ref });
  }
}

module.exports = { GitHubClient, GitHubAppClient };