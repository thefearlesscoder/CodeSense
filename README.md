# RepoGraph Phase 3

RepoGraph parses a JavaScript repository with tree-sitter and can either emit a JSON graph or persist that graph in Neo4j. The parser remains storage-independent: language adapters produce graph facts, and storage modules consume the completed graph.

## Setup

```sh
npm install
```

## Usage

Parse a local repository:

```sh
node parse_repo.js ../small-js-repo --output graph.json
```

Or clone a public Git repository into a temporary directory while parsing:

```sh
node parse_repo.js https://github.com/jonschlinkert/is-number.git --output graph.json
```

The parser currently includes `.js`, `.mjs`, `.cjs`, and `.jsx` files, while skipping generated and dependency directories. Graph nodes are `File`, `Function`, and `Class`; graph edges are `DEFINES`, `IMPORTS`, and resolved local `CALLS`.

## Phase 3: Neo4j persistence

### 1. Start Neo4j locally

Using Docker:

```sh
docker run --name repograph-neo4j \
	-p 7474:7474 -p 7687:7687 \
	-e NEO4J_AUTH=neo4j/password \
	-d neo4j:5
```

Open `http://localhost:7474` and sign in with `neo4j` / `password`. For an existing container, start it with `docker start repograph-neo4j`.

For Neo4j Aura, use the Bolt URI and credentials supplied by Aura instead of the local Docker values.

### Native Neo4j Desktop on macOS

Neo4j Desktop is also supported; Docker is not required. Start the database from Neo4j Desktop and confirm its status is **Running**. The values required by this project are:

| Value | Native local value |
|---|---|
| `NEO4J_URI` | `bolt://127.0.0.1:7687` |
| `NEO4J_USERNAME` | Usually `neo4j` |
| `NEO4J_PASSWORD` | The password chosen when the database was created |
| `NEO4J_DATABASE` | Usually `neo4j` |

The Browser address is normally `http://127.0.0.1:7474`. The Browser port is for the UI; the parser connects through the Bolt port `7687`.

Neo4j does not expose an existing password for recovery. If the standard `neo4j` / `password` credentials fail, open the database details in Neo4j Desktop and use its credentials/password reset action, or create a fresh local database and record the password. Do not put the password in this README or commit it to the repository.

### 2. Configure connection variables

The CLI reads credentials from the environment. Do not commit passwords or `.env` files.

The project includes a local `.env` file with dummy values. Replace `NEO4J_PASSWORD` with your Neo4j Desktop password; the CLI loads this file automatically. The file is ignored by Git.

```sh
export NEO4J_URI='bolt://localhost:7687'
export NEO4J_USERNAME='neo4j'
### 3. Persist a repository graph

The default mode still writes JSON:

```sh
node parse_repo.js https://github.com/thefearlesscoder/EventHub --output graph.json
```

Use `--storage neo4j` to persist instead:

```sh
node parse_repo.js \
	https://github.com/thefearlesscoder/EventHub \
	--storage neo4j \
	--repo-id eventhub
```

If `--repo-id` is omitted, the cloned repository directory name is used. Use an explicit stable ID when the same repository will be indexed again or when multiple repositories are stored in one database.

### 4. What the writer creates

On its first run, the Neo4j storage module creates:

- A unique constraint for `Repo.id`.
- A unique constraint for `CodeNode.key`.
- An index for `CodeNode.repo_id`.
- One `Repo` node for the selected repository.
- `File`, `Function`, and `Class` nodes, each also carrying the `CodeNode` label.
- `CONTAINS` relationships from the repository to each code node.
- `DEFINES`, `IMPORTS`, and `CALLS` relationships from the parsed graph.

All Cypher values are parameters. Labels and relationship types come only from internal allowlists, so repository source content cannot become Cypher syntax.

### 5. Idempotency and stale data

Each persistence operation initializes schema in a separate committed transaction, then runs graph replacement in one Neo4j write transaction:

1. Ensure constraints and indexes exist.
2. Delete the existing `CodeNode` subgraph for the selected `repo_id`.
3. Delete the old `Repo` node.
4. Merge the new `Repo` node.
5. Batch-insert nodes with `UNWIND`.
6. Batch-merge typed relationships with `UNWIND`.

Running the same command twice produces the same graph rather than duplicate nodes or edges. Replacing one repository’s subgraph also removes files, definitions, and relationships that disappeared from the latest parse. Other repositories, identified by their own `repo_id`, are unaffected.

The CLI uses full-repository replacement. The webhook service uses incremental updates: it replaces only changed/removed file slices, rebuilds affected imports, relinks changed calls, and stores the push commit SHA.

### 6. Verify the stored graph

In Neo4j Browser, run:

```cypher
MATCH (repo:Repo {id: 'eventhub'})-[r:CONTAINS]->(node)
RETURN repo, r, node
LIMIT 100;
```

Check counts and relationship types:

```cypher
MATCH (node:CodeNode {repo_id: 'eventhub'})
RETURN node.type, count(node)
ORDER BY node.type;

MATCH ()-[relationship]->()
RETURN type(relationship), count(relationship)
ORDER BY type(relationship);
```

To remove the local database and its data:

```sh
docker rm -f repograph-neo4j
```

## Phase 4: GitHub push webhooks

### 1. Configure the webhook service

Add these values to the local `.env` file. The webhook secret must be the same value configured in GitHub. Use a long random value; never commit it.

```env
GITHUB_WEBHOOK_SECRET=replace-with-a-long-random-secret
GITHUB_TOKEN=replace-with-a-fine-grained-token
PORT=3000
HOST=127.0.0.1
```

`GITHUB_TOKEN` needs repository contents read access for the test repository. A GitHub App installation token is preferred for production; a fine-grained personal access token is sufficient for local testing.

### 2. Start the service

```sh
npm run webhook
```

The service exposes:

```text
GET  /health
POST /webhook/github
```

The webhook route accepts only `push` events. It verifies `X-Hub-Signature-256` against the raw request bytes before parsing JSON. Invalid signatures return `401`; malformed push payloads return `400`; valid events return `202` and process asynchronously.

### 3. Expose the local service

GitHub needs a public HTTPS URL. For local development, use a tunnel such as ngrok:

```sh
ngrok http 3000
```

Use the HTTPS forwarding URL as the webhook target:

```text
https://your-ngrok-subdomain.ngrok-free.app/webhook/github
```

Keep the local service and tunnel running while testing. Do not expose a service without setting `GITHUB_WEBHOOK_SECRET`.

### 4. Register the GitHub webhook

1. Open the test repository on GitHub.
2. Go to **Settings** and then **Webhooks**.
3. Select **Add webhook**.
4. Set the Payload URL to the tunnel URL ending in `/webhook/github`.
5. Set **Content type** to `application/json`.
6. Paste the same `GITHUB_WEBHOOK_SECRET` value.
7. Select **Just the push event**.
8. Enable the webhook and save it.

GitHub sends `X-GitHub-Event`, `X-GitHub-Delivery`, and `X-Hub-Signature-256`. The service logs the delivery ID, repository, commit SHA, changed-file counts, duration, and status without logging tokens, secrets, or source contents.

### 5. What happens after a push

1. The route verifies the HMAC signature with a timing-safe comparison.
2. The payload parser reads `commits[].added`, `modified`, and `removed`.
3. Paths are normalized and unsafe absolute or parent-traversal paths are rejected.
4. The `after` SHA is used, so files are fetched from the exact pushed commit.
5. Octokit fetches only added and modified JavaScript files.
6. The existing JavaScript tree-sitter adapter parses those file contents.
7. Neo4j removes old nodes/relationships for changed and removed files.
8. New definitions, imports, and calls are merged into the repository graph.
9. The delivery ID is marked complete so GitHub retries do not process it twice.

Renames are treated as a removed old path plus an added new path, which prevents stale nodes.

### 6. Test locally without GitHub

Create a signed request using the same secret in `.env`:

```sh
body='{"ref":"refs/heads/main"}'
signature=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" | sed 's/^.* //')
curl --noproxy '*' -X POST http://127.0.0.1:3000/webhook/github \
	-H 'Content-Type: application/json' \
	-H 'X-GitHub-Event: push' \
	-H 'X-GitHub-Delivery: local-test-1' \
	-H "X-Hub-Signature-256: sha256=$signature" \
	--data "$body"
```

The body above is intentionally not a complete push payload, so it should return `400`. Use a real GitHub push or a complete fixture when testing processing.

### 7. Verify the incremental graph

Run the following in Neo4j Browser after a push:

```cypher
MATCH (repo:Repo {id: 'owner/repository'})
RETURN repo.name, repo.commit_sha, repo.updated_at;

MATCH (node:CodeNode {repo_id: 'owner/repository'})
RETURN node.type, count(node)
ORDER BY node.type;
```

The same delivery is idempotent in the process lifetime, and Neo4j relationships use `MERGE`. For production, replace the in-memory delivery store with a durable database or queue so deduplication survives service restarts.

## GitHub App configuration

The webhook supports GitHub App installations. This removes the need for a personal token and per-repository webhook registration.

### App settings

Create a GitHub App under **Settings -> Developer settings -> GitHub Apps**. Configure:

- Webhook URL: your public URL ending in `/webhook/github`.
- Webhook secret: the value used by `GITHUB_APP_WEBHOOK_SECRET`.
- Repository permissions: `Contents: Read-only` and `Metadata: Read-only`.
- Subscribed event: `Push`.
- Generate and download the private key. Store it under `secrets/`; that directory is ignored by Git.

Install the App on the repositories it may index. The installation ID is included in webhook payloads under `installation.id`; it must not be hardcoded as a repository setting.

### App environment

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=./secrets/repograph-app.pem
GITHUB_APP_WEBHOOK_SECRET=replace-with-a-long-random-secret
```

When `GITHUB_APP_ID` is set, the processor exchanges the App ID, private key, and webhook `installation.id` for a short-lived installation token before fetching files. `GITHUB_TOKEN` remains only as a local migration fallback when App configuration is absent.

### Installation and repository records

Installation and repository mappings are stored in Neo4j as `GitHubInstallation` and `GitHubRepository` nodes. Push graphs use the stable repository ID as their tenant key:

```text
github:<github-repository-id>
```

Installation and repository lifecycle events update active/revoked mappings. Delivery records are persisted as `WebhookDelivery` nodes, so duplicate delivery IDs can be rejected across process restarts.

### App verification

After installing the App on a test repository:

1. Start Neo4j, the webhook service, and your tunnel.
2. Configure the App webhook URL once.
3. Push a supported JavaScript file.
4. Check logs for `received`, `accepted`, and `completed`.
5. Query the indexed graph:

```cypher
MATCH (repo:Repo)
WHERE repo.github_id IS NOT NULL
RETURN repo.id, repo.full_name, repo.commit_sha, repo.installation_id;

MATCH (installation:GitHubInstallation)-[:GRANTS_ACCESS_TO]->(repository:GitHubRepository)
RETURN installation.id, installation.active, repository.github_id, repository.full_name;
```

## Extending the parser

The entrypoint coordinates independent modules under `src/`:

- `repository.js` resolves local paths and Git URLs.
- `file-walker.js` discovers source files and owns ignore rules.
- `parser.js` selects a language adapter for each file.
- `languages/javascript.js` extracts JavaScript-specific AST facts.
- `graph-builder.js` converts parsed facts into relationships.
- `ids.js` keeps node IDs stable.

To add another language, create an adapter with this interface and register it in `parse_repo.js`:

```js
const pythonAdapter = {
	name: 'python',
	supports(filePath) {
		return filePath.endsWith('.py');
	},
	parse({ source, relativePath }) {
		return { relativePath, nodes, edges, importPaths, calls };
	}
};
```

The adapter should only understand its language's tree-sitter AST. Import resolution, call linking, deduplication, and graph output stay in the shared graph builder.

## Phase 5: MCP server (5.1-5.5)

The local MCP server exposes read-only graph queries over the official MCP SDK's `stdio` transport. It contains:

- Tools: `get_file_summary`, `find_definition`, `find_usages`, `get_related_files`, and `get_repo_status`.
- Resource: `repo://{repo}/structure`, which returns indexed file paths.
- Neo4j query layer: `src/mcp/graph-queries.js`.
- MCP registration and transport: `src/mcp/server.js`.

Every tool requires a repository ID and every Cypher query scopes by that ID. For GitHub App indexed repositories, use the stable tenant ID:

```text
github:<numeric-github-repository-id>
```

Find it in Neo4j with:

```cypher
MATCH (repo:Repo {full_name: 'vks-07/JavaScript'})
RETURN repo.id, repo.github_id, repo.commit_sha;
```

### Start the local MCP server

The MCP server communicates over stdout, so do not add ordinary logs there. Start it directly when an MCP client launches it:

```sh
npm run mcp
```

It requires the same Neo4j variables already used by the parser:

```env
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
```

Example tool arguments:

```json
{
	"repo": "portfolio-app",
	"path": "src/App.jsx"
}
```

### Run MCP Inspector

Use the official Inspector to list tools/resources and invoke them interactively:

```sh
npx @modelcontextprotocol/inspector node src/mcp/server.js
```

The Inspector opens a local browser UI. Select the stdio server, list the tools, and try:

```text
get_repo_status       { "repo": "portfolio-app" }
get_file_summary      { "repo": "portfolio-app", "path": "src/App.jsx" }
find_definition       { "repo": "portfolio-app", "symbol": "App" }
find_usages           { "repo": "portfolio-app", "symbol": "App" }
get_related_files     { "repo": "portfolio-app", "path": "src/App.jsx" }
```

The server must have access to the same local Neo4j database while Inspector is open. This phase intentionally implements only local `stdio`; hosted Streamable HTTP transport is a later phase.