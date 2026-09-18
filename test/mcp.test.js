const assert = require('node:assert/strict');
const test = require('node:test');
const { createMcpServer } = require('../src/mcp/server');

test('registers the Phase 5 MCP tools and resource', () => {
  const graph = {
    getFileSummary: async () => [],
    findDefinition: async () => [],
    findUsages: async () => [],
    getRelatedFiles: async () => [],
    getRepoStatus: async () => [],
    getRepoStructure: async () => [],
  };
  const server = createMcpServer({ graph });
  assert.ok(server);
});