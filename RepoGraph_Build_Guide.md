# RepoGraph — Complete Build Guide

**What it is:** A living knowledge graph of a GitHub repository, auto-updated on every git push, served as an MCP (Model Context Protocol) server so AI coding assistants (Claude Code, Cursor, GitHub Copilot) always have accurate, structured, up-to-date project context — instead of you re-pasting files or re-explaining your codebase in every new chat.

**Core loop:**
```
GitHub push → webhook → parse changed files → update graph (DB) →
MCP server exposes graph as tools/resources → AI assistant queries it live
```

---

## 0. Before You Start — Big Picture Architecture

```
┌─────────────┐   webhook    ┌──────────────────┐      ┌───────────────┐
│   GitHub    │ ───────────► │  Ingestion Service │ ───► │  Graph Store   │
│  Repository │              │ (clone/pull, parse) │      │   (Neo4j)      │
└─────────────┘              └──────────────────┘      └───────┬───────┘
                                                                 │
      ┌──────────────────────────────────────────────────────────┘
      ▼
┌───────────────┐        MCP protocol        ┌──────────────────┐
│  MCP Server    │ ◄────────────────────────► │  AI Assistant     │
│ (FastMCP)      │                            │ (Claude/Cursor)    │
└───────┬───────┘
        │  REST/GraphQL API
        ▼
┌───────────────┐
│ React Frontend │  (graph visualisation, repo browser, settings)
└───────────────┘
```

Four subsystems you're actually building:
1. **Ingestion pipeline** — clones/pulls a repo, parses code, builds/updates a graph.
2. **Storage layer** — where the graph and metadata live.
3. **MCP server** — the interface AI assistants talk to.
4. **Frontend** — dashboard to connect repos, visualize the graph, manage settings.

Build them **in that order**. Each phase below produces something demoable.

---

## Phase 1 — Foundations & Learning (Week 1)

Don't skip this. Spend a few focused days here so Phase 2+ goes fast.

| Topic | Why you need it | Best resource |
|---|---|---|
| Git internals (objects, refs, webhooks) | You're building on top of git | [Git Internals chapter, Pro Git book](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain) (free) |
| GitHub Webhooks | Trigger updates on push | [GitHub Docs: Webhooks](https://docs.github.com/en/webhooks) |
| GitHub REST API + Octokit | Fetch repo/file data | [Octokit.js docs](https://octokit.github.io/rest.js/) |
| Abstract Syntax Trees (AST) & tree-sitter | Parsing code into structured data | [tree-sitter official docs](https://tree-sitter.github.io/tree-sitter/) + [tree-sitter playground](https://tree-sitter.github.io/tree-sitter/playground) |
| Graph data modeling | Nodes = files/functions/classes, edges = imports/calls | [Neo4j "Graph Data Modeling" guide](https://neo4j.com/docs/getting-started/data-modeling/) |
| Cypher (Neo4j's query language) | You'll write this constantly to read/write the graph | [Cypher Manual — Introduction](https://neo4j.com/docs/cypher-manual/current/introduction/) + [Neo4j "Cypher Fundamentals" free course](https://graphacademy.neo4j.com/courses/cypher-fundamentals/) |
| Neo4j drivers (JS or Python) | How your backend talks to the DB | [neo4j-driver (JavaScript)](https://neo4j.com/docs/javascript-manual/current/) or [neo4j (Python driver)](https://neo4j.com/docs/python-manual/current/) |
| Model Context Protocol (MCP) | The protocol you're serving | [modelcontextprotocol.io](https://modelcontextprotocol.io/introduction) — read "Core Concepts" (Tools/Resources/Prompts) + the [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) guide |
| MCP TypeScript SDK | The official library you'll build the server with (Phase 5) | [`@modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk) on GitHub, plus [ts.sdk.modelcontextprotocol.io](https://ts.sdk.modelcontextprotocol.io) for API reference |
| React + Vite | Frontend tooling | [Vite guide](https://vite.dev/guide/) + [React docs (new)](https://react.dev/learn) |
| React Flow | Graph visualisation in the browser | [reactflow.dev docs](https://reactflow.dev/learn) |
| Tailwind CSS | Styling fast | [tailwindcss.com docs](https://tailwindcss.com/docs/installation) |
| Node.js/Express or FastAPI | Backend API layer | [Express guide](https://expressjs.com/en/starter/installing.html) or [FastAPI tutorial](https://fastapi.tiangolo.com/tutorial/) |
| LangChain (optional, for AI-layer summarization) | Turn code into semantic descriptions | [LangChain Python docs](https://python.langchain.com/docs/introduction/) |

**Learning tip:** you don't need to master these — read just enough to build Phase 2's smallest possible version, then learn more as each next feature demands it. This is far faster than trying to "finish learning" first.

---

## Phase 2 — MVP: Parse One Repo Locally, No Server Yet (Week 2)

Goal: prove the core idea works before adding any networking complexity.

**Steps:**
1. Pick one small local repo (or clone a sample one).
2. Write a script (Python, since tree-sitter's Python bindings are the most mature) that:
   - Walks the file tree.
   - For each source file, parses it with `tree-sitter` (or `@babel/parser` if you go Node/JS route) into an AST.
   - Extracts: file path, functions/classes defined, imports, function calls, docstrings.
3. Store this as a simple in-memory or JSON structure first — nodes (`File`, `Function`, `Class`) and edges (`IMPORTS`, `CALLS`, `DEFINES`).
4. Print/inspect the graph. Confirm relationships are captured correctly (e.g., `auth/login.py` imports `services/repo_graph.py`).

**Deliverable:** a CLI script `python parse_repo.py ./my-repo` that outputs a JSON graph.

**Resources:**
- [tree-sitter Python bindings](https://github.com/tree-sitter/py-tree-sitter)
- [tree-sitter language grammars list](https://github.com/tree-sitter) (you'll need one grammar per language you support — start with Python and JS/TS only)
- Study how existing tools do this for reference: [ast-grep](https://ast-grep.github.io/) and [Sourcegraph's code intelligence docs](https://docs.sourcegraph.com/code_navigation/explanations/precise_code_navigation) explain the same graph-of-code idea.

---

## Phase 3 — Persistent Storage in Neo4j (Week 3)

Goal: move from an in-memory JSON blob to a real, queryable, updatable graph database.

**Why Neo4j fits RepoGraph well:** your data *is* a graph (files/functions/classes as nodes, imports/calls/defines as edges), so queries like "everything two hops away from this file" or "find the shortest dependency path between these two modules" are native Cypher operations instead of recursive SQL joins. This is exactly the kind of query your MCP tools (`get_related_files`, `find_usages`) need to run.

**Note:** you'll still want a small relational store (or Neo4j itself, see below) for plain app data — user accounts, GitHub OAuth tokens, repo metadata, API keys. Two common setups:
- **Neo4j only:** store `User` and `Repo` as nodes too (e.g. `(:User)-[:OWNS]->(:Repo)-[:CONTAINS]->(:File)`). Simplest — one database, one thing to host/learn. **Recommended for this project** since it keeps everything in one free Aura instance.
- **Neo4j + a small Postgres/SQLite for auth only:** cleaner separation of concerns, but adds a second database to host. Only worth it if your auth/billing logic gets complex.

**Data model (labels & relationship types):**
```cypher
// Nodes
(:Repo {id, name, owner, updated_at})
(:File {id, path, language, updated_at})
(:Function {id, name, signature, docstring})
(:Class {id, name, docstring})

// Relationships
(:Repo)-[:CONTAINS]->(:File)
(:File)-[:DEFINES]->(:Function)
(:File)-[:DEFINES]->(:Class)
(:File)-[:IMPORTS]->(:File)
(:Function)-[:CALLS]->(:Function)
(:Class)-[:INHERITS_FROM]->(:Class)
```

**Steps:**
1. Run Neo4j locally for development via Docker — [Neo4j Docker quickstart](https://neo4j.com/docs/operations-manual/current/docker/introduction/), or use a free [Neo4j AuraDB Free](https://neo4j.com/docs/aura/auradb/getting-started/create-database/) instance from day one so local dev matches production (Aura Free gives one instance per account, up to 200,000 nodes / 400,000 relationships — plenty for many small-to-medium repos).
2. Install a driver: [`neo4j-driver`](https://www.npmjs.com/package/neo4j-driver) for Node (this is what Phase 5's MCP server will use to run Cypher queries).
3. Learn Cypher basics (creating nodes/relationships, `MATCH`/`MERGE`/`WHERE`) — [Cypher Fundamentals course](https://graphacademy.neo4j.com/courses/cypher-fundamentals/) (free, ~2 hrs) will cover everything you need for this project.
4. Modify Phase 2's script to write nodes/relationships into Neo4j instead of JSON, using `MERGE` (not `CREATE`) so re-running the parser is idempotent:
   ```cypher
   MERGE (f:File {id: $fileId, repo_id: $repoId})
   SET f.path = $path, f.language = $language, f.updated_at = datetime()
   ```
5. Write an **update function**: given a changed file, delete its old `DEFINES`/`IMPORTS`/`CALLS` relationships and re-create them from the fresh parse, so re-parsing on every push doesn't leave stale edges behind:
   ```cypher
   MATCH (f:File {id: $fileId})-[r:DEFINES|IMPORTS]->()
   DELETE r
   ```
   then re-insert the current relationships.
6. Add constraints/indexes early so lookups stay fast as repos grow:
   ```cypher
   CREATE CONSTRAINT file_id_unique IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE;
   CREATE INDEX file_repo_idx IF NOT EXISTS FOR (f:File) ON (f.repo_id);
   ```

**Deliverable:** running `parse_repo.py` twice on the same repo produces the same graph in Neo4j, not duplicated nodes/edges — verify visually in [Neo4j Browser](https://neo4j.com/docs/browser-manual/current/) or Aura's built-in query console.

---

## Phase 4 — Auto-Update on Git Push (Week 4)

Goal: wire up the "auto-updated on every git push" part.

**Steps:**
1. Build a small backend service (Express or FastAPI) with one endpoint: `POST /webhook/github`.
2. Register a GitHub webhook on a test repo for the `push` event — [GitHub Docs: Creating webhooks](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks).
3. Verify the webhook signature (GitHub sends an `X-Hub-Signature-256` header) — see [Securing your webhooks](https://docs.github.com/en/webhooks/using-webhooks/securing-your-webhooks).
4. On receiving a push event:
   - Read the `commits[].modified/added/removed` file lists from the payload (avoids re-parsing the whole repo every time).
   - Use Octokit (or a shallow `git pull`) to fetch only the changed files' new content.
   - Re-run the Phase 2/3 parser on just those files and `MERGE` the results into Neo4j.
5. For local dev/testing without a public URL, use a tunnel: [ngrok](https://ngrok.com/docs/getting-started/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose your local webhook endpoint.

**Deliverable:** push a commit to a test repo → within seconds, query Neo4j and see the graph reflect the change.

> **Note — this only works for your own test repo right now. For real users with private repos, you need a GitHub App, not a manually-registered webhook.**
>
> The steps above assume you can manually add a webhook to "a test repo" — fine for development, but it doesn't scale to real users, and it definitely doesn't work for private repos you don't own. Two options exist, and only one is correct here:
>
> - **❌ OAuth App + personal access token** — grants your app broad, long-lived access to the user's *entire* GitHub account (all repos), not just the one they want to connect. Avoid this for RepoGraph.
> - **✅ GitHub App** — the user installs your app and picks exactly which repo(s) to grant access to. Permissions are scoped and named (`Contents: Read-only`, `Metadata: Read-only`, `Webhooks: Read & write`), and your app authenticates as itself using a private key, then requests short-lived (1-hour) installation tokens scoped only to that installation's repos — no long-lived per-user secret to store.
>
> **Why this simplifies your webhook setup, not complicates it:** with a GitHub App, you register **one webhook URL on the app itself** (not per-repo). GitHub automatically delivers `push` events for every repo any user installs your app on, tagged with an `installation_id`. You don't call the "create webhook" API per user at all — that manual step in Phase 6's frontend flow goes away entirely once the app is installed.
>
> **What changes in the flow above:**
> 1. User clicks "Connect GitHub" → redirected to your GitHub App's install page → picks which repo(s) to grant access to → redirected back with an `installation_id`.
> 2. You store `installation_id` (+ which repos it covers) against that user in your DB — this replaces manually registering a webhook per repo.
> 3. Your single `/webhook/github` endpoint now receives events from *all* installations; use the `installation.id` in the payload to look up which user/repo it belongs to before processing.
> 4. To fetch file contents for parsing, exchange the stored `installation_id` for a fresh installation access token (via [Octokit App auth](https://github.com/octokit/authentication-strategies.js/#github-app-installation-authentication)) rather than using a stored personal token.
>
> You never see or store the user's GitHub password, and there's no long-lived all-access token sitting in your DB per user — this is the main reason GitHub Apps exist as a distinct concept from OAuth Apps.
>
> **Resources:**
> - [GitHub Apps vs. OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps) — read this first
> - [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
> - [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
> - [Webhook events available to GitHub Apps](https://docs.github.com/en/webhooks/webhook-events-and-payloads) (subscribe to `push` at minimum)
>
> Build against your own test repo with a plain webhook first (steps 1–5 above still work fine for that), but swap to a GitHub App **before** Phase 6, since the frontend's "connect a repo" flow depends on which model you picked.

---

## Phase 5 — The MCP Server (Week 5)

This is the heart of the product — turning your graph into something an AI assistant can query. We'll build this using the **official Model Context Protocol SDK** (from [modelcontextprotocol.io](https://modelcontextprotocol.io)) rather than a third-party framework — since RepoGraph is fundamentally an MCP product, it's worth knowing the spec-level building blocks directly instead of only through an abstraction. Everything here is Node/TypeScript, matching your Phase 4 backend.

### 5.1 — Learn the three primitives first

MCP servers expose three distinct kinds of things, and picking the right one for each RepoGraph feature matters:

| Primitive | What it's for | Who decides to use it | RepoGraph example |
|---|---|---|---|
| **Tools** | Functions the model can call to *take an action or compute something*, including side effects | The **model** decides when to call it | `find_usages`, `get_related_files` |
| **Resources** | File-like, mostly-static data the client can read | The **client application** decides when to fetch it | `repo://my-repo/structure` (a directory tree the client can attach to context) |
| **Prompts** | Pre-written, reusable prompt templates the user explicitly invokes | The **user** decides to invoke it | `/onboard-to-repo` — a canned prompt that primes the assistant with a repo overview |

Read the concept pages before writing code — they're short: [Tools](https://modelcontextprotocol.io/docs/concepts/tools), [Resources](https://modelcontextprotocol.io/docs/concepts/resources), [Prompts](https://modelcontextprotocol.io/docs/concepts/prompts). Most of RepoGraph's value ships as **tools** (the graph queries), with a couple of **resources** for cheap always-available context (repo structure) and one or two **prompts** as a nice-to-have later.

### 5.2 — Project setup

```bash
mkdir repograph-mcp && cd repograph-mcp
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node
npx tsc --init
mkdir src && touch src/index.ts
```
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) is the official TypeScript SDK — check npm for the current package name/version when you build, since the MCP SDK is actively versioned against evolving spec releases (as of writing, `@modelcontextprotocol/sdk` is the stable entry point; a newer `@modelcontextprotocol/server` package tracks the latest spec revision — the [SDK docs](https://ts.sdk.modelcontextprotocol.io) will show which is current).
- `zod` is used for validating your tools' input schemas — the SDK is schema-library-agnostic (Zod, Valibot, ArkType all work), but Zod has the most examples.

### 5.3 — Pick a transport

MCP servers can run over two transports — pick based on how the server will actually be used:

- **`stdio`** — the server runs as a local subprocess the client launches directly. Simplest for local dev/testing, this is what you'll use first.
- **Streamable HTTP** — the server runs remotely and clients connect over HTTP. **This is what RepoGraph needs in production**, since your MCP server is one shared multi-tenant service, not something each user runs locally.

Reference: [Transports guide](https://modelcontextprotocol.io/docs/concepts/transports).

### 5.4 — Build the server: local `stdio` version first

```ts
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { queryRelatedFiles, queryDefinition, queryUsages, getRepoStructure } from "./graph.js";

const server = new McpServer({ name: "RepoGraph", version: "1.0.0" });

server.registerTool(
  "get_related_files",
  {
    title: "Get related files",
    description: "Return files connected to a given file via imports or function calls in the repo's knowledge graph.",
    inputSchema: { repo: z.string(), path: z.string() },
  },
  async ({ repo, path }) => {
    const related = await queryRelatedFiles(repo, path);
    return { content: [{ type: "text", text: JSON.stringify(related) }] };
  }
);

server.registerTool(
  "find_definition",
  {
    title: "Find symbol definition",
    description: "Find where a function or class is defined in the repo.",
    inputSchema: { repo: z.string(), symbol: z.string() },
  },
  async ({ repo, symbol }) => {
    const result = await queryDefinition(repo, symbol);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "find_usages",
  {
    title: "Find symbol usages",
    description: "Find every place a function or class is called or imported across the repo.",
    inputSchema: { repo: z.string(), symbol: z.string() },
  },
  async ({ repo, symbol }) => {
    const usages = await queryUsages(repo, symbol);
    return { content: [{ type: "text", text: JSON.stringify(usages) }] };
  }
);

// A resource: cheap, always-available structural context
server.registerResource(
  "repo-structure",
  "repo://{repo}/structure",
  { title: "Repo file structure", description: "Directory tree of a connected repo", mimeType: "application/json" },
  async (uri, { repo }) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(await getRepoStructure(repo as string)) }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
```
This mirrors your original 5-tool design (`get_repo_structure`, `get_file_summary`, `find_definition`, `find_usages`, `get_related_files`) — `get_repo_structure` moved to a **resource** since it's static-ish data the client can just read, not an action the model needs to decide to invoke; the rest stay as tools since they take parameters and run a live query.

Each `query*` function is where your Cypher from Phase 3 lives — e.g.:
```ts
// src/graph.ts
export async function queryRelatedFiles(repo: string, path: string) {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (f:File {path: $path, repo_id: $repo})-[:IMPORTS|CALLS*1..2]-(related)
       RETURN DISTINCT related.path AS path`,
      { path, repo }
    );
    return result.records.map(r => r.get("path"));
  } finally {
    await session.close();
  }
}
```

### 5.5 — Test it with the MCP Inspector before wiring up any real client

The official [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) is a browser-based debugging tool that lets you call your tools directly and inspect requests/responses — much faster than debugging through Claude Code's UI.
```bash
npx @modelcontextprotocol/inspector node src/index.ts
```
This opens a local web UI where you can list your registered tools/resources, invoke them with test arguments, and see raw JSON-RPC traffic. Get this green before moving on.

### 5.6 — Switch to Streamable HTTP for the real, hosted server

Once tools work locally, swap the transport so the server can run as your always-on backend service instead of a subprocess:
```ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(8080);
```
This is also the point where you fold the MCP server into the **same Express app** as your Phase 4 webhook receiver — one Node service handling both `/webhook/github` and `/mcp`, which simplifies deployment (see [Express middleware helpers](https://github.com/modelcontextprotocol/typescript-sdk) — `@modelcontextprotocol/express` ships small helpers for exactly this wiring).

### 5.7 — Multi-tenancy: scope every tool call to the right user's repo

Since your production server is one shared HTTP endpoint (not a per-user local process), you need to know **which user** is calling before running any Cypher query. Two things to add here:
- **Authenticate the request** — require an API key (issued to each user from your dashboard) in the `Authorization` header, checked before `transport.handleRequest` runs.
- **Scope every query** — pass the authenticated user's allowed `repo_id`(s) into each `query*` function so a tool call can never read another user's graph data, even if they guess a repo name. This is the same `repo_id` boundary discussed in the Neo4j multi-tenancy section later in this doc — enforce it here, at the MCP layer, not just in the database.

Reference: [Authorization guide](https://modelcontextprotocol.io/docs/concepts/authorization) covers the spec's recommended patterns (OAuth-based auth is the spec's preferred approach for remote servers; a simpler bearer API key is a reasonable v1 if you want to ship faster and add OAuth later).

### 5.8 — Connect a real client

- **Claude Code / Claude Desktop:** add your server to its MCP config, pointing at either the local `stdio` command (dev) or your hosted HTTP URL + API key (production) — [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) and [Connect to remote MCP servers](https://modelcontextprotocol.io/docs/develop/connect-remote-servers).
- **Cursor / other MCP-compatible tools:** same idea, config format differs slightly per client — check that client's docs.

### 5.9 — Iterate on descriptions, not just code

The model picks tools based on their `title`/`description` strings — vague descriptions mean the assistant either never calls your tool or calls the wrong one. Write descriptions the way you'd explain the tool to a new teammate, including *when* to use it (e.g. "Use this instead of grepping when you need every call site of a function across the whole repo, including in files not currently open"). This tuning pass matters as much as the Cypher underneath it.

**Deliverable:** open Claude Code in a repo, ask "what does the login flow depend on?", and watch it call your MCP tool instead of guessing.

---

## Phase 6 — Frontend Dashboard (Week 6–7)

Goal: a UI where a user connects their GitHub account/repo, sees the live graph, and manages settings.

**Steps:**
1. Scaffold: `npm create vite@latest repograph-ui -- --template react` — [Vite + React setup](https://vite.dev/guide/#scaffolding-your-first-vite-project).
2. Style with Tailwind — [Tailwind + Vite install guide](https://tailwindcss.com/docs/installation/using-vite).
3. Auth: "Sign in with GitHub" (OAuth) so users can connect their own repos — [GitHub OAuth Apps guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
4. Repo connection flow: use the **GitHub App install flow** (see the note in Phase 4) instead of plain OAuth — redirect the user to your app's install page, let them pick repo(s) during install, then store the returned `installation_id`. No manual "create webhook" API call needed; GitHub delivers events automatically for every repo the app is installed on.
5. Graph visualisation: fetch nodes/edges from your backend API, render with **React Flow** — [React Flow "Layouting" guide](https://reactflow.dev/learn/layouting/layouting) (you'll want an auto-layout algorithm like [dagre](https://github.com/dagrejs/dagre) or [elkjs](https://github.com/kieler/elkjs) since your graph positions aren't manual).
6. Add a page showing the generated MCP server URL + API key for the user to paste into their Claude Code/Cursor config.

**Deliverable:** a user can sign in, connect a repo, see its graph render in the browser, and copy an MCP connection string.

---

## Phase 7 — AI Layer: Semantic Summaries (Week 8, optional but high-value)

Goal: go beyond raw AST facts — add plain-English summaries so the AI assistant gets *meaning*, not just structure.

**Steps:**
1. For each file/function, generate a 1–2 sentence summary via an LLM call (Claude API, or any LLM) and store it in the `metadata` JSONB column.
2. Use **LangChain** (optional) to orchestrate batched summarization jobs with retries/rate-limiting — [LangChain "Summarization" how-to](https://python.langchain.com/docs/tutorials/summarization/).
3. Only regenerate summaries for files that changed (check via the webhook diff from Phase 4) to control API costs.
4. Expose these summaries through a new MCP tool, e.g. `explain_file(repo, path)`.

**Cost tip:** batch small/cheap model calls (e.g. Claude Haiku) for per-function summaries; this keeps costs low even at scale.

---

## Phase 8 — Polish, Auth, Multi-Repo, Multi-User (Week 9)

- Add per-user API keys/tokens so each user's MCP server endpoint only exposes their own repos.
- Rate-limit the webhook and MCP endpoints (see scaling section below).
- Add a "re-index full repo" button for edge cases (webhook missed, first-time connect).
- Write a README + short setup docs — this alone dramatically increases whether people actually adopt it.

---

## Making It Available to the Public

### 1. Ship it as an open-source project first
- Push to GitHub with a clear README (what it does, screenshot/GIF, setup instructions, MCP config snippet users paste into Claude Code/Cursor).
- Add a `LICENSE` (MIT is standard for dev tools).
- This alone gets you real users if you post it in the right places: [MCP Server directory / awesome-mcp-servers list](https://github.com/modelcontextprotocol/servers) (there are several community "awesome MCP servers" lists — submit yours), Reddit r/ClaudeAI, r/programming, Hacker News "Show HN", dev.to, and X/Twitter with a demo video.

### 2. Two ways users can "use" it
- **Self-hosted:** users clone your repo and run their own instance (zero cost to you, but more setup friction for them).
- **Hosted SaaS (what your Instagram post implies):** you run one instance, users sign in and connect their repo, you host the MCP server multi-tenant. This needs the deployment/scaling plan below.

### 3. Deployment (free tier stack)
| Component | Free-tier host | Notes |
|---|---|---|
| Frontend (React/Vite build) | [Vercel](https://vercel.com) or [Cloudflare Pages](https://developers.cloudflare.com/pages/) | Both have generous free static hosting + CDN. |
| Backend API + MCP server | [Render free web service](https://render.com/docs/free) or [Fly.io free allowance](https://fly.io/docs/about/pricing/) | Render free tier: 512MB RAM, spins down after 15 min idle, ~30–60s cold start on wake. Fine for early users; upgrade ($7/mo Render Starter) once you have real traffic. |
| Graph database (Neo4j) | [Neo4j AuraDB Free](https://neo4j.com/docs/aura/auradb/getting-started/create-database/) | One free instance per account: up to 200,000 nodes / 400,000 relationships, no time limit — but it **pauses after 3 days with no write activity** (auto-resumes from the console) and is **deleted if it stays paused 30 days**, so keep something writing periodically (even a small heartbeat write) if you want it always warm. Only one free instance is allowed per account, so all users share this single graph, partitioned by `repo_id`/`owner_id` properties (not separate databases). |
| Background jobs (webhook processing, summarization) | Same backend service, or a free queue like [Upstash QStash free tier](https://upstash.com/pricing) | Keeps webhook responses fast (respond 200 immediately, process async). |
| File/graph cache | [Upstash Redis free tier](https://upstash.com/pricing) (10k commands/day free) | Cache frequent graph queries. |

### 4. Domain & auth
- Free subdomain to start (`repograph.onrender.com`, `repograph.vercel.app`), buy a cheap domain later (~$10/yr) once you want to look production-ready.
- GitHub OAuth for sign-in (free, no cost regardless of user count).

---

## Handling Up to 1,000 Users for Free

Be realistic about what "1,000 users, free" means: it works if usage is *light and bursty* (occasional pushes + occasional AI queries), not if every user has an MCP client polling continuously. Design for that shape:

### Architecture choices that make this survivable on free tiers
1. **Serverless-first for spiky load.** Put the webhook receiver and MCP query endpoints on a platform that scales to zero and back, like [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/) (100k requests/day free) or [Fly.io](https://fly.io/docs/about/pricing/) machines that auto-stop. This avoids paying for idle compute — with 1,000 users, most won't be active at the same second.
2. **Database: one shared Neo4j AuraDB Free instance, partitioned by tenant.** Since Aura Free only allows one instance per account, every user's graph lives in the same database, isolated logically by a `repo_id`/`owner_id` property on every node (never by separate Neo4j databases, which Aura Free doesn't support). Scope **every** Cypher query with `WHERE n.repo_id = $repoId` — this is your multi-tenancy boundary, so get it right and test it early. Aura Free auto-pauses after 3 days of no writes and is deleted after 30 days paused; a lightweight scheduled "keep-alive" write (e.g. a cron job via [GitHub Actions free minutes](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule) or [cron-job.org](https://cron-job.org)) prevents this if traffic ever goes quiet.
3. **Process webhooks asynchronously.** Respond to GitHub's webhook in <1s (just enqueue), do the actual parsing/graph-update in a background worker. This keeps your web service free tier from getting overwhelmed by traffic spikes (e.g. many people pushing at once).
4. **Cache aggressively.** Most MCP tool calls (e.g. `get_repo_structure`) don't change between a user's requests within a session — cache per-repo graph reads in Redis (Upstash free tier: 10k commands/day, 256MB) with a short TTL, invalidated on webhook updates.
5. **Rate-limit per user.** Cap webhook re-index frequency (e.g. debounce: if 5 pushes happen in 10 seconds, only re-index once) and cap MCP queries per user per minute. This single change is what actually protects your free-tier compute/DB limits from being exhausted by a handful of heavy users.
6. **Limit repo size / parse depth on the free plan.** e.g. skip `node_modules`, vendored code, files >1MB, and cap total graph nodes per repo (e.g. 2,000–5,000). This matters more with Neo4j Aura Free than it would with a bigger DB, since your **entire multi-tenant graph shares one 200,000-node / 400,000-relationship ceiling** — capping per-repo size is what keeps 1,000 users from exhausting that budget collectively.
7. **Static frontend on a CDN.** Vercel/Cloudflare Pages free tiers handle far more than 1,000 users' worth of frontend traffic without any tuning needed — this part is basically solved for you.
8. **Monitor free-tier quotas proactively.** Set up simple usage logging (requests/day, DB rows, storage) so you know *before* you hit a hard limit (e.g. Cloudflare Workers' 100k req/day, Upstash's daily command cap) rather than finding out via an outage.

### Rough capacity math (why this works)
- 1,000 users pushing a few times a day ≈ a few thousand webhook events/day — comfortably inside Cloudflare Workers' 100k/day free allowance.
- MCP queries are triggered by *active coding sessions*, not constant polling — realistically a few hundred concurrent-ish light requests, well within Render/Fly free compute if you keep response work fast and cached.
- Graph data for 1,000 small-to-medium repos, with the per-repo node caps in point 6 (say, an average of ~150–200 nodes/repo), lands around 150,000–200,000 nodes total — right at the edge of Aura Free's 200,000-node ceiling. This is the tightest constraint in the whole free stack; if you expect repos to run larger than that, either lower the per-repo cap further or budget for **Neo4j Aura Professional** (usage-based, no fixed monthly minimum) sooner than you'd need to upgrade compute or frontend hosting.

### When you'll need to start paying
The moment you outgrow this is a good problem: it means real usage. At that point, the first upgrade is almost always the backend compute tier (Render Starter ~$7/mo, or Fly.io usage-based) to remove cold starts — do that before touching the DB or frontend tiers, since those free tiers scale much further.

---

## Suggested Timeline Summary

| Phase | Focus | Duration |
|---|---|---|
| 1 | Learn the pieces | Week 1 |
| 2 | Local repo parser (no server) | Week 2 |
| 3 | Persistent graph DB | Week 3 |
| 4 | Webhook auto-update | Week 4 |
| 5 | MCP server | Week 5 |
| 6 | Frontend dashboard | Week 6–7 |
| 7 | AI semantic layer (optional) | Week 8 |
| 8 | Multi-user polish + launch | Week 9 |

Build in this order and you'll have a working, demoable product after **every single phase** — which matters a lot for staying motivated and for showing progress to mentors/teammates along the way.