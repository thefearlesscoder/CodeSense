const fs = require('node:fs/promises');
const path = require('node:path');

async function parseFiles(repoPath, files, adapters) {
  return Promise.all(files.map(async (absolutePath) => {
    const relativePath = toPosix(path.relative(repoPath, absolutePath));
    const source = await fs.readFile(absolutePath, 'utf8');
    const adapter = adapters.find((candidate) => candidate.supports(relativePath));

    if (!adapter) throw new Error(`No language adapter found for ${relativePath}`);
    return adapter.parse({ source, relativePath });
  }));
}

function toPosix(value) { return value.split(path.sep).join('/'); }

module.exports = { parseFiles };
