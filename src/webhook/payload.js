const path = require('node:path');

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);

function parsePushPayload(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new Error('Webhook payload is not valid JSON');
  }

  if (!payload.repository?.full_name || !payload.repository.id || !payload.after) {
    throw new Error('Push payload must include repository.id, repository.full_name, and after');
  }

  const changed = new Set();
  const removed = new Set();
  for (const commit of payload.commits || []) {
    for (const file of [...(commit.added || []), ...(commit.modified || [])]) changed.add(normalizePath(file));
    for (const file of commit.removed || []) removed.add(normalizePath(file));
  }

  for (const file of removed) changed.delete(file);
  return {
    owner: payload.repository.owner?.login || payload.repository.full_name.split('/')[0],
    repo: payload.repository.name || payload.repository.full_name.split('/')[1],
    fullName: payload.repository.full_name,
    repositoryId: String(payload.repository.id),
    installationId: payload.installation?.id ? String(payload.installation.id) : null,
    defaultBranch: payload.repository.default_branch,
    commitSha: payload.after,
    changedPaths: [...changed].filter(isSupportedSource),
    removedPaths: [...removed].filter(isSupportedSource),
  };
}

function normalizePath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe repository path: ${filePath}`);
  }
  return normalized.replace(/^\.\//, '');
}

function isSupportedSource(filePath) {
  return SOURCE_EXTENSIONS.has(path.posix.extname(filePath));
}

module.exports = { parsePushPayload, normalizePath };