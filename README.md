# SQLBot MCP Proxy

MCP server proxy for SQLBot. It exposes SQLBot datasource discovery, table metadata, natural-language Text-to-SQL questions, and local fallback report generation as MCP tools.

<!-- mcp-name: io.github.wenRou21/sqlbot-mcp-proxy -->

## Requirements

- Docker
- A running SQLBot service
- SQLBot API keys

## Recommended Codex Config

Users do not need to download this repository manually. Add this single MCP server to Codex config and replace the SQLBot URL and keys:

```toml
[mcp_servers.sqlbot]
command = "docker"
args = [
  "run",
  "--rm",
  "-i",
  "-e",
  "SQLBOT_MCP_PROXY_BASE_URL",
  "-e",
  "SQLBOT_MCP_PROXY_ACCESS_KEY",
  "-e",
  "SQLBOT_MCP_PROXY_SECRET_KEY",
  "ghcr.io/wenrou21/sqlbot-mcp-proxy:0.1.0"
]
enabled = true
startup_timeout_sec = 120

[mcp_servers.sqlbot.env]
SQLBOT_MCP_PROXY_BASE_URL = "http://183.196.108.32:18088"
SQLBOT_MCP_PROXY_ACCESS_KEY = "<YOUR_SQLBOT_ACCESS_KEY>"
SQLBOT_MCP_PROXY_SECRET_KEY = "<YOUR_SQLBOT_SECRET_KEY>"
```

Then restart Codex completely.

If SQLBot is reachable through another public or LAN address, replace `SQLBOT_MCP_PROXY_BASE_URL` with that address, for example `https://sqlbot.example.com` or `http://192.168.1.10:18088`.

## Prompt Template

```text
Please configure SQLBot MCP for Codex.

MCP image:
ghcr.io/wenrou21/sqlbot-mcp-proxy:0.1.0

My SQLBot URL:
http://183.196.108.32:18088

My SQLBot access key:
<YOUR_SQLBOT_ACCESS_KEY>

My SQLBot secret key:
<YOUR_SQLBOT_SECRET_KEY>

Add this MCP to Codex config:
- MCP name: sqlbot
- command: docker
- args: ["run", "--rm", "-i", "-e", "SQLBOT_MCP_PROXY_BASE_URL", "-e", "SQLBOT_MCP_PROXY_ACCESS_KEY", "-e", "SQLBOT_MCP_PROXY_SECRET_KEY", "ghcr.io/wenrou21/sqlbot-mcp-proxy:0.1.0"]
- startup_timeout_sec: 120
- SQLBOT_MCP_PROXY_BASE_URL: use the SQLBot URL above
- SQLBOT_MCP_PROXY_ACCESS_KEY: use the access key above
- SQLBOT_MCP_PROXY_SECRET_KEY: use the secret key above

After configuration, remind me to fully restart Codex.

After restart:
- Check available datasources with sqlbot_list_datasources.
- Use sqlbot_list_tables and sqlbot_describe_table before asking data questions.
- Use sqlbot_ask_data for Text-to-SQL questions.
- Use sqlbot_generate_report when I ask for an analysis report or chart.
```

## Quick Docker Test

You can test the image outside Codex:

```bash
docker run --rm -i \
  -e SQLBOT_MCP_PROXY_BASE_URL=http://183.196.108.32:18088 \
  -e SQLBOT_MCP_PROXY_ACCESS_KEY=your-access-key \
  -e SQLBOT_MCP_PROXY_SECRET_KEY=your-secret-key \
  ghcr.io/wenrou21/sqlbot-mcp-proxy:0.1.0
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
| `SQLBOT_MCP_PROXY_BASE_URL` | `http://183.196.108.32:18088` | SQLBot service base URL |
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

## Advanced HTTP Mode

Most MCP clients should use stdio. For clients that can send JSON-RPC over HTTP, start:

```bash
docker run --rm -p 8787:8787 \
  -e SQLBOT_MCP_PROXY_BASE_URL=http://183.196.108.32:18088 \
  -e SQLBOT_MCP_PROXY_ACCESS_KEY=your-access-key \
  -e SQLBOT_MCP_PROXY_SECRET_KEY=your-secret-key \
  -e SQLBOT_MCP_PROXY_HTTP_HOST=0.0.0.0 \
  ghcr.io/wenrou21/sqlbot-mcp-proxy:0.1.0 --http
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

3. Publish MCP Registry metadata:

```bash
mcp-publisher login github
mcp-publisher publish
```

The `mcpName` in `package.json` must exactly match `name` in `server.json`.
