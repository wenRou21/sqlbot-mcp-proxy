$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$proxyScript = Join-Path $PSScriptRoot "sqlbot-mcp-proxy.js"
$container = if ($env:SQLBOT_MCP_PROXY_DOCKER_CONTAINER) { $env:SQLBOT_MCP_PROXY_DOCKER_CONTAINER } else { "sqlbot" }

if (-not $env:SQLBOT_MCP_PROXY_ACCESS_KEY) {
    $env:SQLBOT_MCP_PROXY_ACCESS_KEY = docker exec $container sh -lc 'printf %s "$FEISHU_ASK_ACCESS_KEY"'
}

if (-not $env:SQLBOT_MCP_PROXY_SECRET_KEY) {
    $env:SQLBOT_MCP_PROXY_SECRET_KEY = docker exec $container sh -lc 'printf %s "$FEISHU_ASK_SECRET_KEY"'
}

if (-not $env:SQLBOT_MCP_PROXY_BASE_URL) {
    $env:SQLBOT_MCP_PROXY_BASE_URL = "http://127.0.0.1:8000"
}

if (-not $env:SQLBOT_MCP_PROXY_HTTP_HOST) {
    $env:SQLBOT_MCP_PROXY_HTTP_HOST = "127.0.0.1"
}

if (-not $env:SQLBOT_MCP_PROXY_HTTP_PORT) {
    $env:SQLBOT_MCP_PROXY_HTTP_PORT = "8787"
}

Set-Location $repoRoot
& node $proxyScript --http
