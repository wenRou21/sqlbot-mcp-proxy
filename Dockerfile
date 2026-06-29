FROM node:22-alpine

LABEL org.opencontainers.image.title="SQLBot MCP Proxy"
LABEL org.opencontainers.image.description="MCP server proxy for SQLBot natural-language data querying and report generation."
LABEL org.opencontainers.image.source="https://github.com/wenRou21/sqlbot-mcp-proxy"
LABEL org.opencontainers.image.licenses="MIT"
LABEL io.modelcontextprotocol.server.name="io.github.wenRou21/sqlbot-mcp-proxy"

WORKDIR /app
COPY sqlbot-mcp-proxy.js ./sqlbot-mcp-proxy.js

ENTRYPOINT ["node", "/app/sqlbot-mcp-proxy.js"]
