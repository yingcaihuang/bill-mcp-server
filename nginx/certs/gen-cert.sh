#!/bin/bash
# 生成自签发证书，域名 mcp.verycloud.cn，有效期 10 年

DOMAIN="mcp.verycloud.cn"
CERT_DIR="$(cd "$(dirname "$0")" && pwd)"

openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout "${CERT_DIR}/server.key" \
  -out "${CERT_DIR}/server.crt" \
  -subj "/C=CN/ST=Shanghai/L=Shanghai/O=VeryCloud/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN}"

echo "证书已生成："
echo "  ${CERT_DIR}/server.crt"
echo "  ${CERT_DIR}/server.key"
