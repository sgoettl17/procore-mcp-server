# Procore MCP Server

[![procore-mcp-server MCP server](https://glama.ai/mcp/servers/TylerIlunga/procore-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/TylerIlunga/procore-mcp-server)

MCP server that exposes the full [Procore](https://www.procore.com/) REST API to AI assistants like Claude. Built with TypeScript and the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk).

Works with **Claude Desktop**, **Claude Code**, and any MCP-compatible client.

## What it does

A build-time parser converts Procore's OpenAPI spec into a compact catalog, then auto-generates individual MCP tools for every API operation. At runtime, 7 meta-tools let the AI discover and call any Procore endpoint:

| Tool | Purpose |
|------|---------|
| `procore_discover_categories` | List API categories with endpoint counts |
| `procore_discover_endpoints` | List endpoints in a category |
| `procore_search_endpoints` | Full-text search across all endpoints |
| `procore_get_endpoint_details` | Get full parameter schema for an endpoint |
| `procore_api_call` | Execute any Procore API call |
| `procore_get_config` | Show current config and auth status |
| `procore_set_config` | Set runtime config (company_id, project_id) |

## Prerequisites

- Node.js 20+ (`nvm use` selects the CI version)
- A [Procore Developer Portal](https://developers.procore.com/) account

## OAuth setup

One-time Procore login saves tokens to `~/.procore-mcp/tokens.json` (override with `PROCORE_TOKEN_PATH`).

1. Sign in to the [Procore Developer Portal](https://developers.procore.com/) and create an app (or open an existing one).
2. Enable the **Authorization Code** grant and set the redirect URI to **`http://localhost`** (Procore requires this exact non-HTTPS localhost URL for the desktop auth flow).
3. Copy the app **Client ID** and **Client Secret**.
4. In the repo root, copy `.env.example` to `.env` and set at least:

   | Variable | Purpose |
   |----------|---------|
   | `PROCORE_CLIENT_ID` | OAuth client ID from the developer portal |
   | `PROCORE_CLIENT_SECRET` | OAuth client secret |
   | `PROCORE_COMPANY_ID` | Default Procore company ID (integer header for API calls) |

   Optional: `PROCORE_ENV` (`production` or `sandbox`), `PROCORE_TOKEN_PATH`, `PROCORE_TOOL_MODE` (leave unset or `meta` for the 7 discovery tools; see below).

5. Run the interactive OAuth flow (opens a browser; listens on port 80 for the callback):

   ```bash
   npm run auth
   ```

   On Linux/macOS, port 80 may require `sudo npm run auth`. Tokens are written after you approve access in the browser.

## Setup

```bash
git clone https://github.com/sgoettl17/procore-mcp-server.git
cd procore-mcp-server
npm install
```

See [OAuth setup](#oauth-setup) for portal app creation and `npm run auth`.

By default the server exposes the **7 discovery tools**, and every Procore
endpoint is reached through `procore_api_call`. Registering a dedicated tool
per endpoint instead emits roughly 4.7 MB (~1.2M tokens) of tool definitions —
more than any current model's context window — so that surface is opt-in:

```env
PROCORE_TOOL_MODE=all
```

Coverage is identical in both modes; only the size of the advertised tool list
differs. If you switch to `all` and are migrating from before v2.0.0, see
`data/tool-renames.json` for the old -> new tool name map.

The committed `data/` catalog artifacts let a clean checkout compile and test
without Procore credentials or the large OpenAPI file:

```bash
npm ci
npm run build && npm test
```

To refresh the API catalog, obtain the combined OpenAPI JSON from the
[Procore Developer Portal](https://developers.procore.com/) API documentation.
Save it locally as `specs/combined_OAS.json` (create `specs/` first). The upstream
spec is about 54 MB and remains gitignored. Use an authorized portal download;
do not copy OAuth credentials or tokens into the spec, CI, or Git history.
Record the acquisition date, source, and `sha256sum specs/combined_OAS.json` in
the catalog-refresh PR so reviewers can identify the input.

```bash
npm run build:spec
npm test
```

`build:spec` regenerates and validates the catalog before compiling. Review and
commit the generated `data/` artifacts, never the source spec. A missing spec
makes `build:spec` fail; ordinary `build` intentionally uses committed data.
CI runs on Node 20: `npm ci`, then `npm run build` and `npm test`, with no live
API calls or OAuth secrets.

Paperclip must keep `PROCORE_TOOL_MODE=meta` (or leave it unset). Do not set
`PROCORE_TOOL_MODE=all` in Paperclip: the seven discovery tools cover the API
through `procore_api_call` without advertising thousands of endpoint tools.

Start the server (after OAuth setup):

```bash
npm start
```

## Claude Desktop configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "procore": {
      "command": "node",
      "args": ["/absolute/path/to/procore-mcp-server/dist/src/index.js"],
      "env": {
        "PROCORE_CLIENT_ID": "your_client_id",
        "PROCORE_CLIENT_SECRET": "your_client_secret",
        "PROCORE_COMPANY_ID": "your_company_id"
      }
    }
  }
}
```

## Claude Code configuration

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "procore": {
      "command": "node",
      "args": ["/absolute/path/to/procore-mcp-server/dist/src/index.js"],
      "env": {
        "PROCORE_CLIENT_ID": "your_client_id",
        "PROCORE_CLIENT_SECRET": "your_client_secret",
        "PROCORE_COMPANY_ID": "your_company_id"
      }
    }
  }
}
```

## Project structure

```
src/
  auth/       OAuth token exchange, refresh, storage
  api/        HTTP client with auth, rate limits, retries
  catalog/    Endpoint catalog loading, search, filtering
  tools/      MCP tool handlers and registration
scripts/
  generate-catalog.ts          Parse OAS into catalog
  generate-tools-manifest.ts   Generate per-endpoint MCP tools
  validate-catalog.ts          Validate catalog integrity
data/         Build output (committed): catalog.json, endpoint details, tools manifest
specs/        Source OAS file (gitignored — too large for the repo)
```

## How it works

1. **Build time**: `scripts/generate-catalog.ts` parses the ~54MB Procore OpenAPI spec (3,155 operations) and produces a compact `data/catalog.json` plus individual endpoint detail files in `data/endpoint-details/`. `scripts/generate-tools-manifest.ts` then generates a tools manifest with one named MCP tool per API operation — 2,929 in total, after collapsing older-version duplicates of the same path.

   Each generated tool carries a structured description covering what it acts on, when to reach for it, which parent ids to resolve first, what it returns, and how it fails. Endpoints Procore has deprecated are registered with their sunset date in the description and a `(Deprecated)` title. The interactive `/oauth/*` endpoints are not registered as tools — `npm run auth` owns that flow — but remain reachable through `procore_api_call`.

2. **Auth**: Run `npm run auth` once to complete the OAuth flow in your browser. Tokens are saved to `~/.procore-mcp/tokens.json` and auto-refresh when expired.

3. **Runtime**: The MCP server loads the catalog and registers the 7 discovery tools (plus the full per-endpoint surface when `PROCORE_TOOL_MODE=all`). When an AI assistant calls a tool, the server maps it to the correct Procore API endpoint, injects auth headers, handles rate limits and pagination, and returns the response.

## Inspiration

Built to help my girlfriend, a construction engineer who uses Procore daily.

## License

MIT
