const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function resolveRepository(input) {
  if (!/^https?:\/\//.test(input) && !input.endsWith('.git')) {
    const repoPath = path.resolve(input);
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) {
      throw new Error(`Repository path is not a directory: ${repoPath}`);
    }
    return { repoPath, cleanup: async () => {} };
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repograph-'));
  const repoPath = path.join(tempRoot, 'repo');
  await execFileAsync('git', ['clone', '--depth', '1', input, repoPath]);

  return {
    repoPath,
    cleanup: () => fs.rm(tempRoot, { recursive: true, force: true }),
  };
}

module.exports = { resolveRepository };
