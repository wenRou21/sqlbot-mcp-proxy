# SQLBot MCP Proxy

MCP server proxy for SQLBot. It exposes SQLBot datasource discovery, table metadata, natural-language Text-to-SQL questions, and local fallback report generation as MCP tools.

<!-- mcp-name: io.github.wenRou21/sqlbot-mcp-proxy -->

## Requirements

- Node.js 18 or newer
- A running SQLBot service
- SQLBot API keys, or a local SQLBot Docker container that exposes `FEISHU_ASK_ACCESS_KEY` and `FEISHU_ASK_SECRET_KEY`

## Install

Run with Docker:

```bash
docker run --rm -i \
  -e SQLBOT_MCP_PROXY_BASE_URL=http://host.docker.internal:8000 \
  -e SQLBOT_MCP_PROXY_ACCESS_KEY=your-access-key \
  -e SQLBOT_MCP_PROXY_SECRET_KEY=your-secret-key \
  ghcr.io/wenrou21/sqlbot-mcp-proxy:0.1.0
```

Run directly with npm:

```bash
npx -y sqlbot-mcp-proxy
```

Or install globally:

```bash
npm install -g sqlbot-mcp-proxy
sqlbot-mcp-proxy
```

## MCP Client Configuration

Use stdio transport for local MCP clients:

```json
{
  "mcpServers": {
    "sqlbot": {
      "command": "npx",
      "args": ["-y", "sqlbot-mcp-proxy"],
      "env": {
        "SQLBOT_MCP_PROXY_BASE_URL": "http://127.0.0.1:8000",
        "SQLBOT_MCP_PROXY_ACCESS_KEY": "your-access-key",
        "SQLBOT_MCP_PROXY_SECRET_KEY": "your-secret-key"
      }
    }
  }
}
```

If SQLBot is already running in Docker and the keys are available inside that container, you can omit the two key variables and set:

```json
{
  "SQLBOT_MCP_PROXY_DOCKER_CONTAINER": "sqlbot"
}
```

## Tools

- `sqlbot_list_datasources`: list SQLBot datasources visible to the configured API key
- `sqlbot_list_tables`: list checked SQLBot metadata tables for a datasource
- `sqlbot_describe_table`: describe checked fields for a SQLBot metadata table
- `sqlbot_ask_data`: ask SQLBot a natural-language data question
- `sqlbot_generate_report`: generate an analysis report and chart, with a local SVG fallback

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `SQLBOT_MCP_PROXY_BASE_URL` | `http://127.0.0.1:8000` | SQLBot service base URL |
| `SQLBOT_MCP_PROXY_ACCESS_KEY` | empty | SQLBot API access key |
| `SQLBOT_MCP_PROXY_SECRET_KEY` | empty | SQLBot API secret key |
| `FEISHU_ASK_ACCESS_KEY` | empty | Fallback access key name |
| `FEISHU_ASK_SECRET_KEY` | empty | Fallback secret key name |
| `SQLBOT_MCP_PROXY_DOCKER_CONTAINER` | `sqlbot` | Container used for fallback key lookup |
| `SQLBOT_MCP_PROXY_HTTP_HOST` | `127.0.0.1` | HTTP mode host |
| `SQLBOT_MCP_PROXY_HTTP_PORT` | `8787` | HTTP mode port |
| `SQLBOT_MCP_PROXY_HTTP_PATH` | `/mcp` | HTTP mode JSON-RPC path |
| `SQLBOT_MCP_PROXY_HTTP_TIMEOUT_MS` | `120000` | SQLBot HTTP request timeout |
| `SQLBOT_MCP_PROXY_REPORT_OUTPUT_DIR` | `outputs` | Directory for generated fallback SVG reports |

## HTTP Mode

Most MCP clients should use stdio. For clients that can send JSON-RPC over HTTP, start:

```bash
npx -y sqlbot-mcp-proxy --http
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## Publish

1. Confirm package metadata in `package.json`.
2. Publish an OCI image:

```bash
docker build -t ghcr.io/wenrou21/sqlbot-mcp-proxy:0.1.0 .
docker push ghcr.io/wenrou21/sqlbot-mcp-proxy:0.1.0
```

3. Optional: publish the npm package:

```bash
npm login
npm publish --access public
```

4. Publish MCP Registry metadata:

```bash
mcp-publisher login github
mcp-publisher publish
```

The `mcpName` in `package.json` must exactly match `name` in `server.json`.
