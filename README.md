# Bill MCP Server

基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的账单查询服务，提供 Streamable HTTP 远程传输，支持 AI 客户端（Kiro、Claude Desktop 等）通过标准 MCP 协议调用账单查询能力。

## 功能

### query_bill — 统一账单查询

通过 `group_by` 控制分组维度，灵活查询云服务账单。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bill_cycle` | `string[]` | 是 | 账期列表，格式 YYYYMM，例如 `["202606"]` |
| `channel` | `string` | 否 | 服务商/渠道，默认 `aws` |
| `tenant_name` | `string` | 否 | 租户名称（支持代码名或中文公司名） |
| `account_id` | `string[]` | 否 | UsageAccount 列表，不传则查全部可用 |
| `group_by` | `string[]` | 否 | 分组维度，可选值见下方 |

**group_by 可选值：**

- `service` — 按服务分组
- `account` — 按账号分组
- `daily` — 按天分组
- `monthly` — 按月分组

> `daily` 和 `monthly` 互斥，不可同时使用。可组合使用，例如 `["daily", "service"]`。

### list_bill_tenants — 获取可访问租户列表

返回当前凭证可访问的租户，以及每个租户下可访问的 `usage_account` 列表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel` | `string` | 否 | 服务商/渠道，默认 `aws` |
| `bill_cycle` | `string[]` | 否 | 账期列表，格式 YYYYMM；仅在需要附带账单汇总时传入 |
| `include_bill_summary` | `boolean` | 否 | 是否按账号关联账单并返回租户汇总，默认 `false` |

当 `include_bill_summary=true` 时，服务会自动：

- 调用 `/v1/bill/tenants` 获取租户和 `usage_account`
- 调用账单查询接口并强制使用 `group_by=["account"]`
- 用 `usage_account` 和账单返回中的 `account` 字段做关联
- 汇总每个租户命中的账号数量、总金额、总用量，并返回命中的账号明细

### health_check — 健康检查

检查后端账单查询服务的运行状态，无需参数。

## 快速开始

### 安装依赖

```bash
npm install
```

### 本地启动

```bash
npm start
# 或
node server.mjs
```

启动后输出：

```
Bill MCP Server (Streamable HTTP) listening on port 3000
MCP endpoint: http://localhost:3000/racorebill/mcp
Health check: http://localhost:3000/racorebill/health
Bill API:     https://bill.racorecloud.com
```

### 自定义端口

```bash
PORT=8080 node server.mjs
```

### 验证租户与账单关联

```bash
BILL_ACCESS_KEY=your-access-key \
BILL_SECRET_KEY=your-secret-key \
npm run test:tenant-link -- 202606
```

脚本会：

- 先查询租户列表
- 再按账号维度查询指定账期账单
- 最后输出“租户 -> usage_account -> 账单金额/用量”的关联结果

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |

### 固定配置

| 配置项 | 值 | 说明 |
|--------|------|------|
| 账单 API 地址 | `https://bill.racorecloud.com` | 后端 API 地址，代码内固定 |
| MCP 传输协议 | Streamable HTTP | 支持远程连接 |
| 运行模式 | Stateless | 无会话状态，每个请求独立处理 |

## 认证说明

客户端通过 HTTP Headers 传递凭证，服务端不存储任何密钥：

- `X-Bill-Access-Key` — 访问密钥（必填）
- `X-Bill-Secret-Key` — 秘钥（必填）

这些凭证会被转发到后端账单 API 的 `X-Access-Key` / `X-Secret-Key` 头中。

如果客户端未传递 header，工具调用会返回认证失败的错误提示。

## 客户端连接

### 远程 MCP 配置（mcp.json）

```json
{
  "mcpServers": {
    "bill-query": {
      "url": "https://你的服务器地址/racorebill/mcp",
      "headers": {
        "X-Bill-Access-Key": "<your-access-key>",
        "X-Bill-Secret-Key": "<your-secret-key>"
      }
    }
  }
}
```

> 参考 `mcp.json.example` 文件。

### 客户端 UI 配置

在支持远程 MCP 的客户端（如 Kiro）中：

- **Connection type**: Remote
- **Name**: `Bill Query`
- **URL**: `https://你的服务器地址/racorebill/mcp`
- **Headers**:
  - `X-Bill-Access-Key` = `<your-access-key>`
  - `X-Bill-Secret-Key` = `<your-secret-key>`

## 部署

### Docker Compose 部署（推荐）

项目已包含 `docker-compose.yml`，集成 Nginx 反向代理 + 自签 TLS 证书。

```bash
# 直接启动
docker compose up -d --build
```

启动后：
- HTTPS: `https://mcp.verycloud.cn/racorebill/mcp`（443 端口）
- HTTP 自动跳转到 HTTPS（80 端口）
- 健康检查：`https://mcp.verycloud.cn/racorebill/health`

### 证书说明

项目包含自签测试证书（域名 `mcp.verycloud.cn`，有效期 10 年）。

如需重新生成：

```bash
bash nginx/certs/gen-cert.sh
```

如需替换为正式证书，将 `.crt` 和 `.key` 文件放入 `nginx/certs/` 目录，然后重启：

```bash
docker compose restart nginx
```

### 单独 Docker 部署

```bash
docker build -t bill-mcp-server .
docker run -d -p 3000:3000 bill-mcp-server
```

### PM2 部署

```bash
npm install -g pm2
pm2 start server.mjs --name bill-mcp-server
pm2 save
pm2 startup
```

### systemd 部署

```ini
[Unit]
Description=Bill MCP Server
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/bill-mcp-server
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

### Nginx 反向代理（HTTPS）

```nginx
server {
    listen 443 ssl;
    server_name mcp.verycloud.cn;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /mcp {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 300s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

> 注意：由于使用 SSE 流式响应，Nginx 需要关闭 `proxy_buffering`。

## API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/racorebill/mcp` | POST | MCP Streamable HTTP 协议端点 |
| `/racorebill/mcp` | GET | MCP SSE 通知流（协议规范） |
| `/racorebill/mcp` | DELETE | 关闭会话（协议规范） |
| `/racorebill/health` | GET | 服务健康检查 |

## 技术栈

- Node.js 20+
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) v1.29+
- Streamable HTTP Transport（MCP 2025-03-26 规范）
- 原生 `node:http`，无额外框架依赖
