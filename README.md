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
Health check: http://localhost:3000/health
Bill API:     https://bill.racorecloud.com
```

### 自定义端口

```bash
PORT=8080 node server.mjs
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |
| `BILL_ACCESS_KEY` | 内置默认值 | 账单 API 访问密钥 |
| `BILL_SECRET_KEY` | 内置默认值 | 账单 API 秘钥 |

### 固定配置

| 配置项 | 值 | 说明 |
|--------|------|------|
| 账单 API 地址 | `https://bill.racorecloud.com` | 后端 API 地址，代码内固定 |
| MCP 传输协议 | Streamable HTTP | 支持远程连接 |
| 运行模式 | Stateless | 无会话状态，每个请求独立处理 |

## 客户端连接

### 远程 MCP 配置（mcp.json）

```json
{
  "mcpServers": {
    "bill-query": {
      "url": "https://你的服务器地址/racorebill/mcp",
      "headers": {
        "X-Bill-Access-Key": "your-access-key",
        "X-Bill-Secret-Key": "your-secret-key"
      }
    }
  }
}
```

### 客户端 UI 配置

在支持远程 MCP 的客户端（如 Kiro）中：

- **Connection type**: Remote
- **Name**: `Bill Query`
- **URL**: `https://你的服务器地址/racorebill/mcp`
- **Headers**:
  - `X-Bill-Access-Key` = 你的访问密钥
  - `X-Bill-Secret-Key` = 你的秘钥

## 部署

### Docker 部署

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
EXPOSE 3000
CMD ["node", "server.mjs"]
```

构建和运行：

```bash
docker build -t bill-mcp-server .
docker run -d -p 3000:3000 \
  -e BILL_ACCESS_KEY=your-access-key \
  -e BILL_SECRET_KEY=your-secret-key \
  bill-mcp-server
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
Environment=BILL_ACCESS_KEY=your-access-key
Environment=BILL_SECRET_KEY=your-secret-key

[Install]
WantedBy=multi-user.target
```

### Nginx 反向代理（HTTPS）

```nginx
server {
    listen 443 ssl;
    server_name mcp.yourdomain.com;

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
| `/health` | GET | 服务健康检查 |

## 认证说明

客户端通过 HTTP Headers 传递凭证：

- `X-Bill-Access-Key` — 访问密钥
- `X-Bill-Secret-Key` — 秘钥

这些凭证会被转发到后端账单 API 的 `X-Access-Key` / `X-Secret-Key` 头中。

如果客户端未传递 header，服务会使用环境变量或代码内默认值作为 fallback。

## 技术栈

- Node.js 20+
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) v1.29+
- Streamable HTTP Transport（MCP 2025-03-26 规范）
- 原生 `node:http`，无额外框架依赖
