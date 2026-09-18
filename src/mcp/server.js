#!/usr/bin/env node

require('dotenv').config();

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { GraphQueries } = require('./graph-queries');

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function createMcpServer({ graph = GraphQueries.fromEnvironment() } = {}) {
  const server = new McpServer({ name: 'RepoGraph', version: '1.0.0' });

  server.registerTool('get_file_summary', {
    title: 'Get file summary',
    description: 'Return a file and the functions or classes it defines.',
    inputSchema: { repo: z.string().min(1), path: z.string().min(1) },
  }, async ({ repo, path }) => textResult(await graph.getFileSummary(repo, path)));

  server.registerTool('find_definition', {
    title: 'Find symbol definition',
    description: 'Find where a function or class is defined in a repository.',
    inputSchema: { repo: z.string().min(1), symbol: z.string().min(1) },
  }, async ({ repo, symbol }) => textResult(await graph.findDefinition(repo, symbol)));

  server.registerTool('find_usages', {
    title: 'Find symbol usages',
    description: 'Find calls and imports that use a function, class, or file symbol.',
    inputSchema: { repo: z.string().min(1), symbol: z.string().min(1) },
  }, async ({ repo, symbol }) => textResult(await graph.findUsages(repo, symbol)));

  server.registerTool('get_related_files', {
    title: 'Get related files',
    description: 'Return files and symbols connected through imports or calls up to two hops away.',
    inputSchema: { repo: z.string().min(1), path: z.string().min(1) },
  }, async ({ repo, path }) => textResult(await graph.getRelatedFiles(repo, path)));

  server.registerTool('get_repo_status', {
    title: 'Get repository status',
    description: 'Return indexed commit, update time, and graph node count for a repository.',
    inputSchema: { repo: z.string().min(1) },
  }, async ({ repo }) => textResult(await graph.getRepoStatus(repo)));

  server.registerResource('repo-structure', 'repo://{repo}/structure', {
    title: 'Repository structure',
    description: 'The indexed file paths for a repository.',
    mimeType: 'application/json',
  }, async (uri, variables) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await graph.getRepoStructure(variables.repo), null, 2) }],
  }));

  return server;
}

async function main() {
  const graph = GraphQueries.fromEnvironment();
  const server = createMcpServer({ graph });
  await server.connect(new StdioServerTransport());
}

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { createMcpServer, textResult };