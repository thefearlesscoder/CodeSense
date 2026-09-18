class DeliveryStore {
  constructor() {
    this.deliveries = new Map();
  }

  has(deliveryId) {
    return this.deliveries.get(deliveryId) === 'completed' || this.deliveries.get(deliveryId) === 'processing';
  }

  begin(deliveryId) {
    if (this.has(deliveryId)) return false;
    this.deliveries.set(deliveryId, 'processing');
    return true;
  }

  complete(deliveryId) { this.deliveries.set(deliveryId, 'completed'); }
  fail(deliveryId) { this.deliveries.delete(deliveryId); }
  async recordRepository() {}
  async recordInstallation() {}
  async revokeRepository() {}
}

class Neo4jDeliveryStore {
  constructor() {
    const neo4j = require('neo4j-driver');
    this.driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USERNAME || process.env.NEO4J_USER, process.env.NEO4J_PASSWORD));
    this.database = process.env.NEO4J_DATABASE || 'neo4j';
  }

  async begin(deliveryId) {
    const session = this.driver.session({ database: this.database });
    try {
      const existing = await session.executeRead((transaction) => transaction.run(
        'MATCH (delivery:WebhookDelivery {id: $deliveryId}) RETURN delivery.status AS status',
        { deliveryId },
      ));
      if (existing.records.length > 0 && existing.records[0].get('status') === 'completed') return false;
      await session.executeWrite((transaction) => transaction.run(`
        MERGE (delivery:WebhookDelivery {id: $deliveryId})
        SET delivery.status = 'processing', delivery.received_at = coalesce(delivery.received_at, datetime()), delivery.error = null
      `, { deliveryId }));
      return true;
    } finally { await session.close(); }
  }

  async complete(deliveryId) { return this.update(deliveryId, 'completed'); }
  async fail(deliveryId) { return this.update(deliveryId, 'failed'); }
  async recordRepository({ installationId, repositoryId, fullName }) {
    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite((tx) => tx.run(`
        MERGE (installation:GitHubInstallation {id: $installationId})
        SET installation.active = true, installation.updated_at = datetime()
        MERGE (repository:GitHubRepository {github_id: $repositoryId})
        SET repository.full_name = $fullName, repository.installation_id = $installationId
        MERGE (installation)-[:GRANTS_ACCESS_TO]->(repository)
      `, { installationId, repositoryId, fullName }));
    } finally { await session.close(); }
  }
  async recordInstallation({ installationId, active, account }) {
    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite((tx) => tx.run(`
        MERGE (installation:GitHubInstallation {id: $installationId})
        SET installation.active = $active, installation.account = $account, installation.updated_at = datetime()
      `, { installationId, active, account }));
    } finally { await session.close(); }
  }
  async revokeRepository({ installationId, repositoryId }) {
    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite((tx) => tx.run(`
        MATCH (repository:GitHubRepository {github_id: $repositoryId, installation_id: $installationId})
        SET repository.active = false, repository.updated_at = datetime()
      `, { installationId, repositoryId }));
    } finally { await session.close(); }
  }
  async update(deliveryId, status) {
    const session = this.driver.session({ database: this.database });
    try { await session.executeWrite((tx) => tx.run('MATCH (d:WebhookDelivery {id: $deliveryId}) SET d.status = $status, d.completed_at = datetime()', { deliveryId, status })); }
    finally { await session.close(); }
  }
  async close() { await this.driver.close(); }
}

module.exports = { DeliveryStore, Neo4jDeliveryStore };