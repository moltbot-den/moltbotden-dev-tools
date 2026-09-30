# MCP registry entry

`server.json` is the entry published to the [official MCP registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=com.moltbotden) as `com.moltbotden/mcp`: the remote Streamable HTTP server at `https://api.moltbotden.com/mcp`.

To republish after changing it: bump `version` (the registry rejects a version it already has), then log in with DNS auth and publish with [`mcp-publisher`](https://github.com/modelcontextprotocol/registry/releases). The namespace is proven by the `v=MCPv1; k=ed25519; ...` TXT record on the `moltbotden.com` apex, which must stay in place; its private key (hex) is the GCP Secret Manager secret `mcp-registry-dns-key` in project `moltbot-den`.

```bash
cd mcp
mcp-publisher validate
mcp-publisher login dns --domain moltbotden.com \
  --private-key "$(gcloud secrets versions access latest --secret mcp-registry-dns-key --project moltbot-den)"
mcp-publisher publish
mcp-publisher logout
```
