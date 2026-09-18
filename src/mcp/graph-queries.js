const neo4j = require('neo4j-driver');

class GraphQueries {
  constructor({ driver, database = process.env.NEO4J_DATABASE || 'neo4j' } = {}) {
    this.driver = driver || neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME || process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
    );
    this.database = database;
  }

  static fromEnvironment() { return new GraphQueries(); }

  async getRepoStructure(repo) {
    return this.run(`
      MATCH (file:CodeNode:File {repo_id: $repo})
      RETURN file.path AS path
      ORDER BY path
    `, { repo });
  }

  async getFileSummary(repo, filePath) {
    return this.run(`
      MATCH (file:CodeNode:File {repo_id: $repo, path: $path})
      OPTIONAL MATCH (file)-[:DEFINES]->(symbol)
      RETURN file.path AS path, file.language AS language,
             collect({type: symbol.type, name: symbol.name, signature: symbol.signature, docstring: symbol.docstring}) AS symbols
    `, { repo, path: filePath });
  }

  async findDefinition(repo, symbol) {
    return this.run(`
      MATCH (node:CodeNode {repo_id: $repo})
      WHERE node.name = $symbol AND (node:Function OR node:Class)
      RETURN node.type AS type, node.name AS name, node.path AS path,
             node.signature AS signature, node.docstring AS docstring
      ORDER BY path
    `, { repo, symbol });
  }

  async findUsages(repo, symbol) {
    return this.run(`
      MATCH (target:CodeNode {repo_id: $repo, name: $symbol})
      OPTIONAL MATCH (usage)-[relationship:CALLS|IMPORTS]->(target)
      WHERE usage.repo_id = $repo
      RETURN target.type AS targetType, target.path AS targetPath,
             type(relationship) AS relationship, usage.type AS usageType,
             usage.name AS usageName, usage.path AS usagePath
      ORDER BY usagePath
    `, { repo, symbol });
  }

  async getRelatedFiles(repo, filePath) {
    return this.run(`
      MATCH (file:CodeNode:File {repo_id: $repo, path: $path})
      MATCH (file)-[:IMPORTS|CALLS*1..2]-(related:CodeNode)
      WHERE related.repo_id = $repo
      RETURN DISTINCT related.type AS type, related.path AS path, related.name AS name
      ORDER BY path, name
    `, { repo, path: filePath });
  }

  async getRepoStatus(repo) {
    return this.run(`
      MATCH (repository:Repo {id: $repo})
      OPTIONAL MATCH (node:CodeNode {repo_id: $repo})
      RETURN repository.id AS id, repository.full_name AS fullName,
             repository.commit_sha AS commitSha, repository.updated_at AS updatedAt,
             count(node) AS nodeCount
    `, { repo });
  }

  async run(query, parameters) {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(query, parameters);
      return result.records.map((record) => record.toObject());
    } finally {
      await session.close();
    }
  }

  async close() { await this.driver.close(); }
}

module.exports = { GraphQueries };