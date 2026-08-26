# @githits/mcp

Reusable MCP server APIs and tool registrations for GitHits.

This package exposes transport-neutral helpers for servers that want the GitHits MCP tool surface without the local `githits` CLI startup, auth storage, or Commander wiring.

## API

- `createMcpServer(options)` creates an MCP server with GitHits tools registered.
- `registerMcpTools(server, options)` registers GitHits tools on an existing MCP server.
- `getMcpToolDescriptors()` returns static tool metadata without requiring concrete services.
- `buildMcpQuickStart(options?)` builds the guide returned by the read-only `quick_start` tool.
- `buildMcpInstructions(options?)` is a deprecated compatibility alias for `buildMcpQuickStart()`.
- `@githits/mcp/client` exports concrete GitHits service implementations, static token providers, URL/config helpers, request-header helpers, the `ServiceDiagnostics` type, and registry helpers for remote MCP servers. Service clients are silent by default; hosts that need operation spans or debug events inject a `ServiceDiagnostics` implementation through their runtime options.
- The former module-global telemetry lifecycle helpers (`startTelemetrySpan`, `endTelemetrySpan`, `flushTelemetry`, and `withTelemetrySpan`) are not exported from `@githits/mcp/client`. Remote hosts own diagnostics lifecycle and destinations through injection.
- `@githits/mcp/smoke-test` exports reusable smoke assertions and `runMcpSmoke()` for remote MCP server validation.

The package expects callers to provide service implementations through `McpToolServices` or a request-scoped `McpToolServicesProvider`. GitHits does not populate MCP initialize instructions because hosts expose them inconsistently; `quick_start` owns shared guidance instead. Callers may still pass their own `instructions` explicitly. Use `quickStartOptions` to configure the guide. Servers can pass `traceTool` to `createMcpServer()` or `registerMcpTools()` to wrap public tool execution for instrumentation without receiving arguments or auth data.

Only imports from `@githits/mcp`, `@githits/mcp/client`, `@githits/mcp/smoke-test`, and `@githits/mcp/package.json` are public. The workspace alias `@githits/mcp/internal` is not exported, is not supported for external consumers, and must not be used by remote MCP server implementations.

Remote MCP servers should provide request-scoped services through `createMcpServer()` and keep transport, auth/session handling, deployment config, and observability outside this package.
