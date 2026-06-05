# @githits/mcp

Reusable MCP server APIs and tool registrations for GitHits.

This package exposes transport-neutral helpers for servers that want the GitHits MCP tool surface without the local `githits` CLI startup, auth storage, or Commander wiring.

## API

- `createMcpServer(options)` creates an MCP server with GitHits tools registered.
- `registerMcpTools(server, options)` registers GitHits tools on an existing MCP server.
- `getMcpToolDescriptors()` returns static tool metadata without requiring concrete services.
- `buildMcpInstructions(options?)` builds the GitHits MCP instruction block.

The package expects callers to provide service implementations through `McpToolServices` or a request-scoped `McpToolServicesProvider`.
