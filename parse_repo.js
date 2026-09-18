#!/usr/bin/env node

require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArguments } = require('./src/cli');
const { resolveRepository } = require('./src/repository');
const { collectSourceFiles } = require('./src/file-walker');
const { parseFiles } = require('./src/parser');
const { buildGraph } = require('./src/graph-builder');
const { javascriptAdapter } = require('./src/languages/javascript');

async function main() {
  const { input, output, storage, repoId } = parseArguments(process.argv.slice(2));
  const { repoPath, cleanup } = await resolveRepository(input);

  try {
    const files = await collectSourceFiles(repoPath);
    const parsedFiles = await parseFiles(repoPath, files, [javascriptAdapter]);
    const graph = buildGraph(repoPath, files, parsedFiles);
    if (storage === 'neo4j') {
      const { Neo4jStore } = require('./src/storage/neo4j-store');
      const store = Neo4jStore.fromEnvironment({ repoId: repoId || graph.repo });
      try {
        await store.saveGraph(graph);
        console.error(`Stored ${graph.nodes.length} nodes and ${graph.edges.length} edges in Neo4j`);
      } finally {
        await store.close();
      }
    } else if (output) {
      const serialized = `${JSON.stringify(graph, null, 2)}\n`;
      await fs.writeFile(path.resolve(output), serialized);
      console.error(`Wrote ${graph.nodes.length} nodes and ${graph.edges.length} edges to ${output}`);
    } else {
      process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
    }
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
