import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";

// Configuration
const BASE_URL = "https://bill.racorecloud.com";

const PORT = process.env.PORT || 3000;
const REQUIRED_HEADERS = ["X-Bill-Access-Key", "X-Bill-Secret-Key"];

// Store per-request context (headers) so tools can access credentials
let requestContext = {};

function getRequestCredentials() {
  const accessKey = requestContext.accessKey;
  const secretKey = requestContext.secretKey;

  if (!accessKey || !secretKey) {
    const missing = [];
    if (!accessKey) missing.push(REQUIRED_HEADERS[0]);
    if (!secretKey) missing.push(REQUIRED_HEADERS[1]);

    return {
      error: {
        content: [
          {
            type: "text",
            text: [
              `认证失败：缺少必需的 HTTP Header: ${missing.join(", ")}`,
              "",
              "请在 MCP 客户端连接配置中添加以下 Headers:",
              "  X-Bill-Access-Key: <你的访问密钥>",
              "  X-Bill-Secret-Key: <你的秘钥>",
            ].join("\n"),
          },
        ],
        isError: true,
      },
    };
  }

  return { accessKey, secretKey };
}

function normalizeGroupBy(groupBy) {
  if (!groupBy) return { groupBy: undefined };

  const normalized = groupBy.flatMap((item) =>
    item.includes(",") ? item.split(",").map((value) => value.trim()) : [item]
  );

  if (normalized.includes("daily") && normalized.includes("monthly")) {
    return {
      error: {
        content: [
          {
            type: "text",
            text: "group_by 参数错误：daily 和 monthly 互斥，不可同时使用。请只选择其中一个。",
          },
        ],
        isError: true,
      },
    };
  }

  const allowed = new Set(["service", "account", "daily", "monthly"]);
  const invalid = normalized.filter((value) => !allowed.has(value));
  if (invalid.length > 0) {
    return {
      error: {
        content: [
          {
            type: "text",
            text: `group_by 参数错误：不支持的值 [${invalid.join(", ")} ]。允许的值为: service, account, daily, monthly。`,
          },
        ],
        isError: true,
      },
    };
  }

  return { groupBy: normalized };
}

async function requestBillApi(path, { method = "GET", accessKey, secretKey, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Access-Key": accessKey,
      "X-Secret-Key": secretKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function fetchBillTenants(accessKey, secretKey) {
  return requestBillApi("/billapi/v1/bill/tenants", { accessKey, secretKey });
}

async function fetchBillQuery(accessKey, secretKey, body) {
  return requestBillApi("/billapi/v1/bill/query", {
    method: "POST",
    accessKey,
    secretKey,
    body,
  });
}

function buildTenantBillSummary(tenants, billRows, billQuery) {
  const rowsByAccount = new Map(
    billRows.map((row) => [String(row.account), row])
  );

  return tenants.map((tenant) => {
    const matchedAccounts = (tenant.usage_account || [])
      .map((account) => rowsByAccount.get(String(account)))
      .filter(Boolean);

    const payableAmount = matchedAccounts.reduce(
      (sum, row) => sum + Number(row.payable_amount || 0),
      0
    );
    const usageQuantity = matchedAccounts.reduce(
      (sum, row) => sum + Number(row.usage_quantity || 0),
      0
    );

    return {
      tenant_name: tenant.tenant_name,
      sc_name: tenant.sc_name,
      usage_account: tenant.usage_account || [],
      matched_account_count: matchedAccounts.length,
      bill_summary: {
        bill_cycle: billQuery.bill_cycle,
        channel: billQuery.channel,
        currency: matchedAccounts[0]?.currency || null,
        payable_amount: Number(payableAmount.toFixed(6)),
        usage_quantity: Number(usageQuantity.toFixed(6)),
      },
      matched_accounts: matchedAccounts,
    };
  });
}

// Create MCP server
function createMcpServerInstance() {
  const server = new McpServer({
    name: "bill-query-server",
    version: "1.0.0",
  });

  // Register the bill query tool
  server.tool(
    "query_bill",
    "统一账单查询 — 通过 group_by 控制分组维度（service/account/daily/monthly）",
    {
      bill_cycle: z
        .array(z.string())
        .describe('账期列表，格式 YYYYMM，例如 ["202606"]'),
      channel: z
        .string()
        .optional()
        .default("aws")
        .describe("服务商/渠道，默认 aws"),
      tenant_name: z
        .string()
        .optional()
        .describe("租户名称（支持代码名或中文公司名）"),
      account_id: z
        .array(z.string())
        .optional()
        .describe("UsageAccount 列表，不传则查全部可用"),
      group_by: z
        .array(z.string())
        .optional()
        .describe(
          '分组维度，每个元素必须是独立的值: "service"(按服务), "account"(按账号), "daily"(按天), "monthly"(按月)。daily 和 monthly 互斥，不可同时传。可组合，例如 ["daily","service"] 或 ["account","service"]。注意：每个维度必须是数组中单独的元素，不要用逗号拼接在一个字符串里。'
        ),
    },
    async ({ bill_cycle, channel, tenant_name, account_id, group_by }) => {
      const normalized = normalizeGroupBy(group_by);
      if (normalized.error) return normalized.error;

      const credentials = getRequestCredentials();
      if (credentials.error) return credentials.error;

      const body = { bill_cycle, channel };
      if (tenant_name) body.tenant_name = tenant_name;
      if (account_id) body.account_id = account_id;
      if (normalized.groupBy) body.group_by = normalized.groupBy;

      try {
        const data = await fetchBillQuery(
          credentials.accessKey,
          credentials.secretKey,
          body
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Request error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_bill_tenants",
    "获取当前凭证可访问的租户列表；可选附带指定账期的账单账号关联汇总",
    {
      channel: z
        .string()
        .optional()
        .default("aws")
        .describe("服务商/渠道，默认 aws"),
      bill_cycle: z
        .array(z.string())
        .optional()
        .describe('可选账期列表，格式 YYYYMM，例如 ["202606"]；传入后可附带账单汇总'),
      include_bill_summary: z
        .boolean()
        .optional()
        .default(false)
        .describe("是否按账号关联账单并返回每个租户的账单汇总"),
    },
    async ({ channel, bill_cycle, include_bill_summary }) => {
      if (include_bill_summary && (!bill_cycle || bill_cycle.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text: "include_bill_summary=true 时必须提供 bill_cycle，例如 [\"202606\"]。",
            },
          ],
          isError: true,
        };
      }

      const credentials = getRequestCredentials();
      if (credentials.error) return credentials.error;

      try {
        const tenantsResponse = await fetchBillTenants(
          credentials.accessKey,
          credentials.secretKey
        );

        const tenants = (tenantsResponse.data || []).map((tenant) => ({
          tenant_name: tenant.tenant_name,
          sc_name: tenant.sc_name,
          usage_account: tenant.usage_account || [],
          usage_account_count: (tenant.usage_account || []).length,
        }));

        if (!include_bill_summary) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    code: tenantsResponse.code,
                    message: tenantsResponse.message,
                    data: tenants,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const billResponse = await fetchBillQuery(
          credentials.accessKey,
          credentials.secretKey,
          {
            bill_cycle,
            channel,
            group_by: ["account"],
          }
        );

        const linkedData = buildTenantBillSummary(
          tenantsResponse.data || [],
          billResponse.data || [],
          billResponse.query || { bill_cycle, channel }
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  code: tenantsResponse.code,
                  message: tenantsResponse.message,
                  query: billResponse.query,
                  data: linkedData,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Request error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Health check tool
  server.tool("health_check", "检查账单查询服务健康状态", {}, async () => {
    try {
      const response = await fetch(`${BASE_URL}/billapi/health`);
      const data = await response.json();
      return {
        content: [
          {
            type: "text",
            text: `Service healthy: ${JSON.stringify(data)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Health check failed: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// --- HTTP Server with Streamable HTTP transport (stateless mode) ---

const httpServer = createServer(async (req, res) => {
  // CORS headers for remote access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Mcp-Session-Id, X-Bill-Access-Key, X-Bill-Secret-Key"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only handle /racorebill/mcp endpoint
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/racorebill/mcp") {
    // Simple health endpoint for the MCP server itself
    if (url.pathname === "/racorebill/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "bill-mcp-server" }));
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  // Extract credentials from request headers (passed by MCP client)
  requestContext = {
    accessKey: req.headers["x-bill-access-key"],
    secretKey: req.headers["x-bill-secret-key"],
  };

  // Create a new server + transport per request (stateless mode)
  const server = createMcpServerInstance();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(PORT, () => {
  console.log(`Bill MCP Server (Streamable HTTP) listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/racorebill/mcp`);
  console.log(`Health check: http://localhost:${PORT}/racorebill/health`);
  console.log(`Bill API:     ${BASE_URL}`);
  console.log("");
  console.log("Remote clients connect with headers:");
  console.log("  X-Bill-Access-Key: <access key>");
  console.log("  X-Bill-Secret-Key: <secret key>");
});
