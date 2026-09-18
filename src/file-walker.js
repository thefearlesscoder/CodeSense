const fs = require('node:fs/promises');
const path = require('node:path');

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next']);

async function collectSourceFiles(repoPath, options = {}) {
  const extensions = options.extensions || SOURCE_EXTENSIONS;
  const ignoredDirectories = options.ignoredDirectories || IGNORED_DIRECTORIES;
  const files = [];

  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (extensions.has(path.extname(entry.name))) files.push(absolutePath);
    }
  }

  await visit(repoPath);
  return files.sort();
}

module.exports = { collectSourceFiles, IGNORED_DIRECTORIES, SOURCE_EXTENSIONS };
