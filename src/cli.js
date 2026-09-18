function parseArguments(args) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: node parse_repo.js <local-path-or-git-url> [--output graph.json | --storage neo4j] [--repo-id id]');
    process.exit(args.length === 0 ? 1 : 0);
  }

  const input = args[0];
  const outputIndex = args.indexOf('--output');
  const output = outputIndex === -1 ? null : args[outputIndex + 1];
  const storageIndex = args.indexOf('--storage');
  const storage = storageIndex === -1 ? 'json' : args[storageIndex + 1];
  const repoIdIndex = args.indexOf('--repo-id');
  const repoId = repoIdIndex === -1 ? null : args[repoIdIndex + 1];

  if (outputIndex !== -1 && !output) {
    throw new Error('--output requires a file path');
  }

  if (storageIndex !== -1 && !['json', 'neo4j'].includes(storage)) {
    throw new Error('--storage must be either json or neo4j');
  }

  if (storage === 'neo4j' && output) {
    throw new Error('--output cannot be combined with --storage neo4j');
  }

  if (repoIdIndex !== -1 && !repoId) {
    throw new Error('--repo-id requires a value');
  }

  return { input, output, storage, repoId };
}

module.exports = { parseArguments };
