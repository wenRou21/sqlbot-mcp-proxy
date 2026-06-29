#!/usr/bin/env node

const SQLBOT_BASE_URL = (process.env.SQLBOT_MCP_PROXY_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const SQLBOT_HTTP_TIMEOUT_MS = Number(process.env.SQLBOT_MCP_PROXY_HTTP_TIMEOUT_MS || "120000");
const HTTP_HOST = process.env.SQLBOT_MCP_PROXY_HTTP_HOST || "127.0.0.1";
const HTTP_PORT = Number(process.env.SQLBOT_MCP_PROXY_HTTP_PORT || "8787");
const HTTP_PATH = process.env.SQLBOT_MCP_PROXY_HTTP_PATH || "/mcp";
const DEFAULT_ACCESS_KEY = process.env.SQLBOT_MCP_PROXY_ACCESS_KEY || process.env.FEISHU_ASK_ACCESS_KEY || "";
const DEFAULT_SECRET_KEY = process.env.SQLBOT_MCP_PROXY_SECRET_KEY || process.env.FEISHU_ASK_SECRET_KEY || "";
const DOCKER_CONTAINER = process.env.SQLBOT_MCP_PROXY_DOCKER_CONTAINER || "sqlbot";
const REPORT_CHART_TIMEOUT_MS = Number(process.env.SQLBOT_MCP_PROXY_REPORT_CHART_TIMEOUT_MS || "45000");
const REPORT_OUTPUT_DIR = process.env.SQLBOT_MCP_PROXY_REPORT_OUTPUT_DIR || "outputs";

const tools = [
  {
    name: "sqlbot_list_datasources",
    description: "List SQLBot datasources available to the configured SQLBot API key.",
    inputSchema: {
      type: "object",
      properties: {
        access_key: { type: "string", description: "Optional SQLBot API access key. Defaults to proxy env." },
        secret_key: { type: "string", description: "Optional SQLBot API secret key. Defaults to proxy env." },
        oid: { type: "integer", description: "Optional workspace id for admin users." }
      },
      additionalProperties: false
    }
  },
  {
    name: "sqlbot_list_tables",
    description: "List checked SQLBot metadata tables for a datasource.",
    inputSchema: {
      type: "object",
      properties: {
        access_key: { type: "string", description: "Optional SQLBot API access key. Defaults to proxy env." },
        secret_key: { type: "string", description: "Optional SQLBot API secret key. Defaults to proxy env." },
        datasource_id: { type: "integer", description: "SQLBot datasource id." }
      },
      required: ["datasource_id"],
      additionalProperties: false
    }
  },
  {
    name: "sqlbot_describe_table",
    description: "Describe checked fields for a SQLBot metadata table.",
    inputSchema: {
      type: "object",
      properties: {
        access_key: { type: "string", description: "Optional SQLBot API access key. Defaults to proxy env." },
        secret_key: { type: "string", description: "Optional SQLBot API secret key. Defaults to proxy env." },
        datasource_id: { type: "integer", description: "SQLBot datasource id." },
        table_name: { type: "string", description: "Table name to describe." }
      },
      required: ["datasource_id", "table_name"],
      additionalProperties: false
    }
  },
  {
    name: "sqlbot_ask_data",
    description: "Ask SQLBot a natural-language data question through the existing Text-to-SQL pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        access_key: { type: "string", description: "Optional SQLBot API access key. Defaults to proxy env." },
        secret_key: { type: "string", description: "Optional SQLBot API secret key. Defaults to proxy env." },
        datasource_id: { type: ["integer", "string"], description: "Optional SQLBot datasource id." },
        question: { type: "string", description: "Natural-language data question." },
        finish_step: {
          type: "string",
          enum: ["generate_sql", "query_data", "generate_chart"],
          default: "generate_chart"
        },
        return_img: { type: "boolean", default: true },
        include_analysis: { type: "boolean", default: true },
        data_preview_limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
        lang: { type: "string", default: "zh-CN" }
      },
      required: ["question"],
      additionalProperties: false
    }
  },
  {
    name: "sqlbot_generate_report",
    description: "Generate a SQLBot data report with analysis, conclusion, and chart. Falls back to a local SVG chart/report when SQLBot chart generation fails or times out.",
    inputSchema: {
      type: "object",
      properties: {
        access_key: { type: "string", description: "Optional SQLBot API access key. Defaults to proxy env." },
        secret_key: { type: "string", description: "Optional SQLBot API secret key. Defaults to proxy env." },
        datasource_id: { type: ["integer", "string"], description: "Optional SQLBot datasource id." },
        question: { type: "string", description: "Natural-language report request." },
        data_preview_limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
        lang: { type: "string", default: "zh-CN" },
        chart_timeout_ms: { type: "integer", minimum: 5000, maximum: 120000, default: 45000 },
        prefer_sqlbot_chart: { type: "boolean", default: false, description: "Try SQLBot native chart generation before returning the local fallback report." }
      },
      required: ["question"],
      additionalProperties: false
    }
  }
];

let buffer = Buffer.alloc(0);
let dockerAuthCache = null;
let transportMode = null;

function logError(message) {
  process.stderr.write(`[sqlbot-mcp-proxy] ${message}\n`);
}

function sendMessage(message) {
  const json = JSON.stringify(message);
  if (transportMode === "jsonl") {
    process.stdout.write(`${json}\n`);
    return;
  }
  const body = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  sendMessage({ jsonrpc: "2.0", id, error });
}

function makeResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id, error };
}

function parseMessages() {
  while (true) {
    const leading = buffer.toString("utf8", 0, Math.min(buffer.length, 32)).trimStart();
    if (leading && !leading.toLowerCase().startsWith("content-length:")) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) {
        return;
      }
      const rawLine = buffer.slice(0, lineEnd).toString("utf8").trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!rawLine) {
        continue;
      }
      transportMode = "jsonl";
      try {
        handleMessage(JSON.parse(rawLine)).catch((error) => {
          logError(`Failed to handle message: ${error.stack || error.message}`);
        });
      } catch (error) {
        logError(`Failed to parse message: ${error.stack || error.message}`);
      }
      continue;
    }

    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) {
      return;
    }
    const raw = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    transportMode = "headers";
    try {
      handleMessage(JSON.parse(raw)).catch((error) => {
        logError(`Failed to handle message: ${error.stack || error.message}`);
      });
    } catch (error) {
      logError(`Failed to parse message: ${error.stack || error.message}`);
    }
  }
}

function safeText(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value, digits = 1) {
  const number = toNumber(value) || 0;
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: number % 1 === 0 ? 0 : Math.min(1, digits)
  }).format(number);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getTabularData(result) {
  const summary = result && result.data;
  const raw = summary && summary.raw;
  const candidates = [
    summary && summary.data_preview,
    raw && raw.data,
    raw && raw.raw && raw.raw.data,
    summary && summary.data
  ];
  for (const candidate of candidates) {
    if (candidate && Array.isArray(candidate.data)) {
      return {
        fields: Array.isArray(candidate.fields) ? candidate.fields : Object.keys(candidate.data[0] || {}),
        rows: candidate.data
      };
    }
  }
  return { fields: [], rows: [] };
}

function chooseReportFields(fields, rows) {
  const normalizedFields = fields.length ? fields : Object.keys(rows[0] || {});
  const labelPatterns = [/product/i, /game/i, /name/i, /产品/, /游戏/];
  const valuePatterns = [/gross/i, /revenue/i, /amount/i, /pay/i, /收入/, /充值/, /内购/, /金额/, /消耗/];
  const secondaryPatterns = [/net/i, /分后/, /利润/, /成本/];
  const stringFields = normalizedFields.filter((field) =>
    rows.some((row) => typeof row[field] === "string" && row[field].trim())
  );
  const numericFields = normalizedFields.filter((field) =>
    rows.some((row) => toNumber(row[field]) !== null)
  );
  const labelField =
    stringFields.find((field) => labelPatterns.some((pattern) => pattern.test(field))) ||
    stringFields[0] ||
    normalizedFields[0];
  const valueField =
    numericFields.find((field) => valuePatterns.some((pattern) => pattern.test(field))) ||
    numericFields[0];
  const secondaryField =
    numericFields.find((field) => field !== valueField && secondaryPatterns.some((pattern) => pattern.test(field))) ||
    numericFields.find((field) => field !== valueField) ||
    "";
  return { labelField, valueField, secondaryField };
}

function makeReportSvg(title, rows, labelField, valueField, secondaryField) {
  const values = rows.map((row) => toNumber(row[valueField]) || 0);
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  const width = 1180;
  const height = Math.max(420, 150 + rows.length * 56);
  const left = 190;
  const top = 98;
  const barMax = 720;
  const barHeight = 32;
  const gap = 24;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<text x="40" y="48" font-family="Microsoft YaHei, SimHei, Arial, sans-serif" font-size="25" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>`,
    `<text x="40" y="76" font-family="Microsoft YaHei, SimHei, Arial, sans-serif" font-size="14" fill="#64748b">自动报告图表 · 主指标：${escapeXml(valueField)}${secondaryField ? ` · 参考指标：${escapeXml(secondaryField)}` : ""}</text>`
  ];
  rows.forEach((row, index) => {
    const value = values[index];
    const y = top + index * (barHeight + gap);
    const barWidth = Math.round((value / max) * barMax * 10) / 10;
    const share = total > 0 ? (value / total) * 100 : 0;
    const color = index === 0 ? "#2563eb" : index < 4 ? "#60a5fa" : value > 0 ? "#cbd5e1" : "#e2e8f0";
    const label = row[labelField] || `第${index + 1}项`;
    const secondary = secondaryField ? ` · ${secondaryField} ${formatNumber(row[secondaryField])}` : "";
    lines.push(`<text x="40" y="${y + 22}" font-family="Microsoft YaHei, SimHei, Arial, sans-serif" font-size="15" fill="#334155">${index + 1}. ${escapeXml(label)}</text>`);
    lines.push(`<rect x="${left}" y="${y}" width="${barMax}" height="${barHeight}" rx="6" fill="#f1f5f9"/>`);
    lines.push(`<rect x="${left}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="${color}"/>`);
    lines.push(`<text x="${left + barMax + 18}" y="${y + 20}" font-family="Microsoft YaHei, SimHei, Arial, sans-serif" font-size="14" fill="#0f172a">${formatNumber(value)} · ${share.toFixed(1)}%${escapeXml(secondary)}</text>`);
  });
  const top1Share = total > 0 ? ((values[0] || 0) / total) * 100 : 0;
  const top4Share = total > 0 ? values.slice(0, 4).reduce((sum, value) => sum + value, 0) / total * 100 : 0;
  lines.push(`<rect x="40" y="${height - 52}" width="${width - 80}" height="1" fill="#e2e8f0"/>`);
  lines.push(`<text x="40" y="${height - 24}" font-family="Microsoft YaHei, SimHei, Arial, sans-serif" font-size="14" fill="#334155">合计 ${formatNumber(total)}；Top1 占比 ${top1Share.toFixed(1)}%；Top4 占比 ${top4Share.toFixed(1)}%。</text>`);
  lines.push("</svg>");
  return lines.join("\n");
}

function writeReportSvg(svg) {
  const fs = require("node:fs");
  const path = require("node:path");
  const outputDir = path.isAbsolute(REPORT_OUTPUT_DIR) ? REPORT_OUTPUT_DIR : path.join(process.cwd(), REPORT_OUTPUT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `sqlbot-report-${new Date().toISOString().replace(/[:.]/g, "-")}.svg`);
  fs.writeFileSync(filePath, svg, "utf8");
  return filePath;
}

function buildFallbackReport(result, args, warnings) {
  const { rows } = getTabularData(result);
  if (!rows.length) {
    return {
      ok: result && result.ok !== false,
      data: {
        mode: "query_data",
        report: {
          title: "SQLBot 数据报告",
          analysis: "查询成功，但结果为空或不是表格数据，无法生成有效图表。",
          conclusion: "当前口径下暂无可展示数据。",
          chart_path: "",
          chart_svg: "",
          row_count: 0
        },
        ask_result: result && result.data ? result.data : result
      },
      warnings
    };
  }
  const fields = Object.keys(rows[0] || {});
  const { labelField, valueField, secondaryField } = chooseReportFields(fields, rows);
  if (!valueField) {
    return {
      ok: true,
      data: {
        mode: "query_data",
        report: {
          title: "SQLBot 数据报告",
          analysis: "查询结果没有可识别的数值指标，已返回原始数据但未生成图表。",
          conclusion: "需要在问题里明确一个数值指标，例如收入、消耗、金额或数量。",
          chart_path: "",
          chart_svg: "",
          row_count: rows.length
        },
        ask_result: result.data
      },
      warnings
    };
  }
  const rankedRows = rows
    .slice()
    .sort((a, b) => (toNumber(b[valueField]) || 0) - (toNumber(a[valueField]) || 0))
    .slice(0, Math.min(rows.length, args.data_preview_limit || 10));
  const values = rankedRows.map((row) => toNumber(row[valueField]) || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const top1 = rankedRows[0];
  const top1Value = values[0] || 0;
  const top1Share = total > 0 ? top1Value / total * 100 : 0;
  const top4Share = total > 0 ? values.slice(0, 4).reduce((sum, value) => sum + value, 0) / total * 100 : 0;
  const positiveCount = values.filter((value) => value > 0).length;
  const zeroCount = values.filter((value) => value === 0).length;
  const title = "SQLBot 自动分析报告";
  const chartSvg = makeReportSvg(title, rankedRows, labelField, valueField, secondaryField);
  const chartPath = writeReportSvg(chartSvg);
  const topLabel = top1 ? top1[labelField] || "第一名" : "第一名";
  const analysis = [
    `本次结果共 ${rankedRows.length} 行，主指标为 ${valueField}，合计 ${formatNumber(total)}。`,
    `头部项目 ${topLabel} 为 ${formatNumber(top1Value)}，占比 ${top1Share.toFixed(1)}%，${top1Share >= 50 ? "头部集中度很高" : "头部集中度相对分散"}。`,
    `前 4 名合计占比 ${top4Share.toFixed(1)}%，${top4Share >= 80 ? "主要贡献集中在前几名" : "中腰部仍有一定贡献"}。`,
    zeroCount ? `结果中有 ${zeroCount} 个项目主指标为 0，需要区分是正常无量、未投放，还是数据回传/口径问题。` : `结果中有 ${positiveCount} 个项目主指标为正。`
  ].join("\n");
  const conclusion = top1Share >= 70
    ? `结论：当前盘面由 ${topLabel} 明显主导，建议优先复盘该项目的活动、投放、版本和付费点变化，同时关注尾部 0 值项目是否存在数据或经营异常。`
    : "结论：当前盘面没有单一项目绝对主导，建议继续拆分渠道、素材或合作方维度定位增长来源。";
  return {
    ok: true,
    data: {
      mode: "fallback_report",
      report: {
        title,
        analysis,
        conclusion,
        chart_path: chartPath,
        chart_svg: chartSvg,
        label_field: labelField,
        value_field: valueField,
        secondary_field: secondaryField,
        total,
        top1_share: top1Share / 100,
        top4_share: top4Share / 100,
        positive_count: positiveCount,
        zero_count: zeroCount,
        row_count: rankedRows.length
      },
      ask_result: result.data
    },
    warnings
  };
}

function readDockerEnv(name) {
  const { execFileSync } = require("node:child_process");
  try {
    return execFileSync(
      "docker",
      ["exec", DOCKER_CONTAINER, "sh", "-lc", `printf %s "$${name}"`],
      { encoding: "utf8", windowsHide: true, timeout: 5000 }
    ).trim();
  } catch {
    return "";
  }
}

async function getDockerAuth() {
  if (dockerAuthCache) {
    return dockerAuthCache;
  }
  const accessKey = readDockerEnv("FEISHU_ASK_ACCESS_KEY");
  const secretKey = readDockerEnv("FEISHU_ASK_SECRET_KEY");
  dockerAuthCache = { accessKey, secretKey };
  return dockerAuthCache;
}

async function withAuth(args = {}) {
  let accessKey = args.access_key || DEFAULT_ACCESS_KEY;
  let secretKey = args.secret_key || DEFAULT_SECRET_KEY;
  if (!accessKey || !secretKey) {
    const dockerAuth = await getDockerAuth();
    accessKey = accessKey || dockerAuth.accessKey;
    secretKey = secretKey || dockerAuth.secretKey;
  }
  if (!accessKey || !secretKey) {
    throw new Error("SQLBot API key is not configured. Set SQLBOT_MCP_PROXY_ACCESS_KEY and SQLBOT_MCP_PROXY_SECRET_KEY, or pass access_key/secret_key in tool arguments.");
  }
  const payload = { ...args, access_key: accessKey, secret_key: secretKey };
  return payload;
}

async function callSqlbot(path, args, options = {}) {
  const payload = await withAuth(args || {});
  const controller = new AbortController();
  const requestTimeoutMs = Number(options.timeoutMs || SQLBOT_HTTP_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  let text;
  try {
    response = await fetch(`${SQLBOT_BASE_URL}/api/v1/mcp/agent/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Connection": "close" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    text = await response.text();
  } catch (error) {
    if (error && error.name === "AbortError") {
      return {
        ok: false,
        data: {},
        warnings: [`SQLBot request timed out after ${requestTimeoutMs}ms`],
        trace: { base_url: SQLBOT_BASE_URL, path }
      };
    }
    return {
      ok: false,
      data: {},
      warnings: [`SQLBot request failed: ${error.message || String(error)}`],
      trace: { base_url: SQLBOT_BASE_URL, path }
    };
  } finally {
    clearTimeout(timeout);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, warnings: [`Non-JSON response from SQLBot: HTTP ${response.status}`], data: { text } };
  }
  if (!response.ok && data.ok !== false) {
    data = { ok: false, warnings: [`HTTP ${response.status}`], data };
  }
  return data;
}

async function callTool(name, args) {
  if (name === "sqlbot_list_datasources") {
    return callSqlbot("list_datasources", args);
  }
  if (name === "sqlbot_list_tables") {
    return callSqlbot("list_tables", args);
  }
  if (name === "sqlbot_describe_table") {
    return callSqlbot("describe_table", args);
  }
  if (name === "sqlbot_ask_data") {
    return callSqlbot("ask_data", {
      finish_step: "generate_chart",
      return_img: true,
      include_analysis: true,
      data_preview_limit: 50,
      ...(args || {})
    });
  }
  if (name === "sqlbot_generate_report") {
    const reportArgs = {
      data_preview_limit: 50,
      ...(args || {})
    };
    if (reportArgs.prefer_sqlbot_chart) {
      const chartResult = await callSqlbot("ask_data", {
        ...reportArgs,
        finish_step: "generate_chart",
        return_img: true,
        include_analysis: true
      }, {
        timeoutMs: Number(reportArgs.chart_timeout_ms || REPORT_CHART_TIMEOUT_MS)
      });
      if (chartResult && chartResult.ok !== false && chartResult.data) {
        const reportData = chartResult.data;
        const hasReport =
          reportData.image_url ||
          reportData.analysis ||
          reportData.answer ||
          (reportData.chart && Object.keys(reportData.chart).length > 0);
        if (hasReport) {
          return {
            ok: true,
            data: {
              mode: "sqlbot_chart",
              report: {
                title: "SQLBot 自动分析报告",
                analysis: reportData.analysis || reportData.answer || "",
                conclusion: reportData.answer || reportData.analysis || "",
                image_url: reportData.image_url || "",
                chart: reportData.chart || {},
                chart_path: "",
                chart_svg: ""
              },
              ask_result: reportData
            },
            warnings: chartResult.warnings || [],
            trace: chartResult.trace || {}
          };
        }
      }
    }
    const queryArgs = {
      ...reportArgs,
      finish_step: "query_data",
      return_img: false,
      include_analysis: false
    };
    delete queryArgs.prefer_sqlbot_chart;
    delete queryArgs.chart_timeout_ms;
    const queryResult = await callSqlbot("ask_data", queryArgs);
    const warnings = [
      ...((queryResult && queryResult.warnings) || []),
      "Generated a local report from SQLBot query data."
    ];
    const fallback = buildFallbackReport(queryResult, reportArgs, warnings);
    fallback.trace = {
      query_trace: queryResult && queryResult.trace
    };
    return fallback;
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function dispatchMessage(message) {
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      return makeResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "sqlbot-mcp-proxy", version: "0.1.0" }
      });
    }
    if (method === "notifications/initialized") {
      return null;
    }
    if (method === "tools/list") {
      return makeResult(id, { tools });
    }
    if (method === "tools/call") {
      const result = await callTool(params.name, params.arguments || {});
      return makeResult(id, {
        content: [
          {
            type: "text",
            text: safeText(result)
          }
        ],
        isError: result && result.ok === false
      });
    }
    if (id !== undefined) {
      return makeError(id, -32601, `Method not found: ${method}`);
    }
    return null;
  } catch (error) {
    if (id !== undefined) {
      return makeError(id, -32000, error.message || String(error));
    } else {
      logError(error.stack || error.message || String(error));
      return null;
    }
  }
}

async function handleMessage(message) {
  const response = await dispatchMessage(message);
  if (response) {
    sendMessage(response);
  }
}

async function dispatchHttpBody(body) {
  if (Array.isArray(body)) {
    const responses = [];
    for (const message of body) {
      const response = await dispatchMessage(message);
      if (response) {
        responses.push(response);
      }
    }
    return responses.length ? responses : null;
  }
  return dispatchMessage(body);
}

function writeJson(response, statusCode, payload, extraHeaders = {}) {
  const body = payload === undefined || payload === null ? "" : JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1",
    "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...extraHeaders
  });
  response.end(body);
}

function startHttpServer() {
  const http = require("node:http");
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `${HTTP_HOST}:${HTTP_PORT}`}`);

    if (request.method === "OPTIONS") {
      writeJson(response, 204, null);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        server: "sqlbot-mcp-proxy",
        mcp_url: `http://${HTTP_HOST}:${HTTP_PORT}${HTTP_PATH}`,
        sqlbot_base_url: SQLBOT_BASE_URL
      });
      return;
    }

    if (url.pathname !== HTTP_PATH) {
      writeJson(response, 404, { error: `Not found. Use ${HTTP_PATH}` });
      return;
    }

    if (request.method !== "POST") {
      writeJson(response, 405, { error: "Method not allowed. Use POST for MCP JSON-RPC." });
      return;
    }

    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch (error) {
        writeJson(response, 400, makeError(null, -32700, `Parse error: ${error.message}`));
        return;
      }

      try {
        const rpcResponse = await dispatchHttpBody(body);
        if (!rpcResponse) {
          writeJson(response, 202, null);
          return;
        }
        writeJson(response, 200, rpcResponse, {
          "MCP-Protocol-Version": "2024-11-05"
        });
      } catch (error) {
        writeJson(response, 500, makeError(null, -32000, error.message || String(error)));
      }
    });
    request.on("error", (error) => {
      logError(error.stack || error.message);
      if (!response.headersSent) {
        writeJson(response, 500, makeError(null, -32000, error.message || String(error)));
      }
    });
  });

  server.listen(HTTP_PORT, HTTP_HOST, () => {
    logError(`HTTP MCP server listening at http://${HTTP_HOST}:${HTTP_PORT}${HTTP_PATH}`);
  });
}

if (process.argv.includes("--http")) {
  startHttpServer();
} else {
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parseMessages();
  });

  process.stdin.on("error", (error) => {
    logError(error.stack || error.message);
  });
}
