const neo4j = require('neo4j-driver');
const path = require('node:path');

const NODE_LABELS = new Set(['File', 'Function', 'Class']);
const EDGE_TYPES = new Set(['DEFINES', 'IMPORTS', 'CALLS']);

class Neo4jStore {
  constructor({ uri, username, password, database = 'neo4j', repoId }) {
    if (!uri || !username || !password || !repoId) {
      throw new Error('Neo4j requires NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, and a repository ID');
    }

    this.repoId = repoId;
    this.database = database;
    this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }

  static fromEnvironment({ repoId }) {
    return new Neo4jStore({
      uri: process.env.NEO4J_URI,
      username: process.env.NEO4J_USERNAME || process.env.NEO4J_USER,
      password: process.env.NEO4J_PASSWORD,
      database: process.env.NEO4J_DATABASE || 'neo4j',
      repoId,
    });
  }

  async saveGraph(graph, metadata = {}) {
    validateGraph(graph);
    const session = this.driver.session({ database: this.database });

    try {
      await session.executeWrite(async (transaction) => {
        for (const query of SCHEMA_QUERIES) await transaction.run(query);
      });

      await session.executeWrite(async (transaction) => {
        await transaction.run(DELETE_NODES_QUERY, { repoId: this.repoId });
        await transaction.run(DELETE_REPO_QUERY, { repoId: this.repoId });
        await transaction.run(MERGE_REPO_QUERY, {
          repoId: this.repoId,
          name: graph.repo,
          schemaVersion: graph.schema_version,
          commitSha: metadata.commitSha || null,
          githubRepositoryId: metadata.githubRepositoryId || null,
          installationId: metadata.installationId || null,
        });
        const nodesByType = groupBy(graph.nodes, (node) => node.type);
        for (const [type, nodes] of Object.entries(nodesByType)) {
          await transaction.run(MERGE_NODE_QUERIES[type], {
            repoId: this.repoId,
            nodes: nodes.map((node) => toNeo4jNode(node, this.repoId)),
          });
        }

        for (const [type, edges] of Object.entries(groupBy(graph.edges, (edge) => edge.type))) {
          await transaction.run(MERGE_EDGE_QUERIES[type], {
            repoId: this.repoId,
            edges: edges.map((edge) => ({
              from: `${this.repoId}:${edge.from}`,
              to: `${this.repoId}:${edge.to}`,
            })),
          });
        }
      });
    } finally {
      await session.close();
    }
  }

  async getFileMetadata() {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        'MATCH (file:CodeNode:File {repo_id: $repoId}) RETURN file.path AS path, file.imports AS imports',
        { repoId: this.repoId },
      );
      return result.records.map((record) => ({ path: record.get('path'), imports: record.get('imports') || [] }));
    } finally {
      await session.close();
    }
  }

  async hasGraph() {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        'MATCH (repo:Repo {id: $repoId})-[:CONTAINS]->(:CodeNode) RETURN count(*) AS count',
        { repoId: this.repoId },
      );
      return result.records[0].get('count').toNumber() > 0;
    } finally {
      await session.close();
    }
  }

  async applyChanges({ repoName, commitSha, githubRepositoryId = null, installationId = null, parsedFiles, removedPaths }) {
    validateParsedFiles(parsedFiles);
    const existingFiles = await this.getFileMetadata();
    const changedPaths = parsedFiles.map((file) => file.relativePath);
    const removed = new Set(removedPaths);
    const availableFiles = new Set(existingFiles.map((file) => file.path));
    for (const file of removed) availableFiles.delete(file);
    for (const file of changedPaths) availableFiles.add(file);

    const importSources = existingFiles
      .filter((file) => !removed.has(file.path) && !changedPaths.includes(file.path))
      .concat(parsedFiles.map((file) => ({
        path: file.relativePath,
        imports: file.importPaths,
      })));
    const imports = importSources.flatMap((source) => resolveImportEdges(source, availableFiles));
    const calls = parsedFiles.flatMap((file) => file.calls.map((call) => ({
      from: `${this.repoId}:${call.from}`,
      name: call.name,
    })));
    const pathsToReplace = [...new Set([...changedPaths, ...removedPaths])];
    const session = this.driver.session({ database: this.database });

    try {
      await session.executeWrite(async (transaction) => {
        for (const query of SCHEMA_QUERIES) await transaction.run(query);
      });
      await session.executeWrite(async (transaction) => {
        await transaction.run(DELETE_FILE_SLICES_QUERY, { repoId: this.repoId, paths: pathsToReplace });
        await transaction.run(MERGE_REPO_QUERY, {
          repoId: this.repoId,
          name: repoName,
          schemaVersion: 1,
          commitSha,
          githubRepositoryId,
          installationId,
        });

        for (const [type, nodes] of Object.entries(groupBy(parsedFiles.flatMap((file) => file.nodes), (node) => node.type))) {
          await transaction.run(MERGE_NODE_QUERIES[type], {
            repoId: this.repoId,
            nodes: nodes.map((node) => toNeo4jNode(node, this.repoId)),
          });
        }
        for (const [type, edges] of Object.entries(groupBy(parsedFiles.flatMap((file) => file.edges), (edge) => edge.type))) {
          await transaction.run(MERGE_EDGE_QUERIES[type], {
            repoId: this.repoId,
            edges: edges.map((edge) => ({ from: `${this.repoId}:${edge.from}`, to: `${this.repoId}:${edge.to}` })),
          });
        }
        await transaction.run(MERGE_IMPORTS_QUERY, { repoId: this.repoId, edges: imports });
        await transaction.run(MERGE_CALLS_QUERY, { repoId: this.repoId, calls });
      });
    } finally {
      await session.close();
    }
  }

  async close() {
    await this.driver.close();
  }
}

const SCHEMA_QUERIES = [
`CREATE CONSTRAINT repograph_repo_id IF NOT EXISTS
FOR (repo:Repo) REQUIRE repo.id IS UNIQUE`,
`CREATE INDEX repograph_github_id IF NOT EXISTS
FOR (repo:Repo) ON (repo.github_id)`,
`CREATE CONSTRAINT repograph_node_key IF NOT EXISTS
FOR (node:CodeNode) REQUIRE node.key IS UNIQUE`,
`CREATE INDEX repograph_node_repo IF NOT EXISTS
FOR (node:CodeNode) ON (node.repo_id)`,
`CREATE CONSTRAINT repograph_installation_id IF NOT EXISTS
FOR (installation:GitHubInstallation) REQUIRE installation.id IS UNIQUE`,
`CREATE CONSTRAINT repograph_github_repository_id IF NOT EXISTS
FOR (repository:GitHubRepository) REQUIRE repository.github_id IS UNIQUE`,
`CREATE CONSTRAINT repograph_delivery_id IF NOT EXISTS
FOR (delivery:WebhookDelivery) REQUIRE delivery.id IS UNIQUE`,
];

const MERGE_NODE_QUERIES = {
  File: `
UNWIND $nodes AS item
MERGE (node:CodeNode:File {key: item.key})
SET node.repo_id = $repoId, node.type = item.type, node.path = item.path,
    node.name = item.name, node.language = item.language, node.signature = item.signature,
  node.docstring = item.docstring, node.imports = item.imports
WITH node
MATCH (repo:Repo {id: $repoId})
MERGE (repo)-[:CONTAINS]->(node)
`,
  Function: `
UNWIND $nodes AS item
MERGE (node:CodeNode:Function {key: item.key})
SET node.repo_id = $repoId, node.type = item.type, node.path = item.path,
    node.name = item.name, node.language = item.language, node.signature = item.signature,
    node.docstring = item.docstring
WITH node
MATCH (repo:Repo {id: $repoId})
MERGE (repo)-[:CONTAINS]->(node)
`,
  Class: `
UNWIND $nodes AS item
MERGE (node:CodeNode:Class {key: item.key})
SET node.repo_id = $repoId, node.type = item.type, node.path = item.path,
    node.name = item.name, node.language = item.language, node.signature = item.signature,
    node.docstring = item.docstring
WITH node
MATCH (repo:Repo {id: $repoId})
MERGE (repo)-[:CONTAINS]->(node)
`,
};

const MERGE_EDGE_QUERIES = {
  DEFINES: createEdgeQuery('DEFINES'),
  IMPORTS: createEdgeQuery('IMPORTS'),
  CALLS: createEdgeQuery('CALLS'),
};

function createEdgeQuery(type) {
  return `
UNWIND $edges AS item
MATCH (from:CodeNode {key: item.from, repo_id: $repoId})
MATCH (to:CodeNode {key: item.to, repo_id: $repoId})
MERGE (from)-[:${type}]->(to)
`;
}

const DELETE_REPO_QUERY = `
MATCH (repo:Repo {id: $repoId})
DETACH DELETE repo
`;

const DELETE_NODES_QUERY = `
MATCH (node:CodeNode {repo_id: $repoId})
DETACH DELETE node
`;

const MERGE_REPO_QUERY = `
MERGE (repo:Repo {id: $repoId})
SET repo.name = $name, repo.schema_version = $schemaVersion, repo.updated_at = datetime(),
    repo.commit_sha = $commitSha, repo.github_id = $githubRepositoryId,
    repo.full_name = $name, repo.installation_id = $installationId
`;

const DELETE_FILE_SLICES_QUERY = `
MATCH (file:CodeNode:File {repo_id: $repoId})
WHERE file.path IN $paths
OPTIONAL MATCH (file)-[:DEFINES]->(symbol)
WITH collect(DISTINCT file) AS files, collect(DISTINCT symbol) AS symbols
UNWIND symbols AS symbol
DETACH DELETE symbol
WITH files
UNWIND files AS file
DETACH DELETE file
`;

const MERGE_IMPORTS_QUERY = `
UNWIND $edges AS item
MATCH (from:CodeNode:File {repo_id: $repoId, path: item.from})
MATCH (to:CodeNode:File {repo_id: $repoId, path: item.to})
MERGE (from)-[:IMPORTS]->(to)
`;

const MERGE_CALLS_QUERY = `
UNWIND $calls AS item
MATCH (from:CodeNode {repo_id: $repoId, key: item.from})
MATCH (to:CodeNode:Function {repo_id: $repoId, name: item.name})
MERGE (from)-[:CALLS]->(to)
`;

function toNeo4jNode(node, repoId) {
  return {
    key: `${repoId}:${node.id}`,
    type: node.type,
    path: node.path || null,
    name: node.name || null,
    language: node.language || null,
    signature: node.signature || null,
    docstring: node.docstring || null,
    imports: node.imports || [],
  };
}

function validateParsedFiles(parsedFiles) {
  for (const file of parsedFiles) {
    if (!file.relativePath || !Array.isArray(file.nodes) || !Array.isArray(file.edges)) {
      throw new Error('Invalid parsed file result');
    }
  }
}

function resolveImportEdges(source, files) {
  return (source.imports || []).flatMap((importPath) => {
    if (!importPath.startsWith('.')) return [];
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(source.path), importPath));
    const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.jsx`, `${base}/index.js`];
    const target = candidates.find((candidate) => files.has(candidate));
    return target ? [{ from: source.path, to: target }] : [];
  });
}

function validateGraph(graph) {
  for (const node of graph.nodes) {
    if (!NODE_LABELS.has(node.type)) throw new Error(`Unsupported graph node type: ${node.type}`);
  }
  for (const edge of graph.edges) {
    if (!EDGE_TYPES.has(edge.type)) throw new Error(`Unsupported graph edge type: ${edge.type}`);
  }
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});
}

module.exports = { Neo4jStore, validateGraph };