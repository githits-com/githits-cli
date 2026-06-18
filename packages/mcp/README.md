# @githits/mcp

Reusable MCP server APIs and tool registrations for GitHits.

This package exposes transport-neutral helpers for servers that want the GitHits MCP tool surface without the local `githits` CLI startup, auth storage, or Commander wiring.

## API

- `createMcpServer(options)` creates an MCP server with GitHits tools registered.
- `registerMcpTools(server, options)` registers GitHits tools on an existing MCP server.
- `getMcpToolDescriptors()` returns static tool metadata without requiring concrete services.
- `buildMcpInstructions(options?)` builds the GitHits MCP instruction block.

The package expects callers to provide service implementations through `McpToolServices` or a request-scoped `McpToolServicesProvider`.

Only imports from `@githits/mcp` are public. The workspace alias `@githits/mcp/internal` is not exported, is not supported for external consumers, and must not be used by remote MCP server implementations.

Remote MCP servers should provide request-scoped services through `createMcpServer()` and keep transport, auth/session handling, deployment config, and observability outside this package.
