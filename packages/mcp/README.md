# @githits/mcp

Reusable MCP server APIs and tool registrations for GitHits.

This package exposes transport-neutral helpers for servers that want the GitHits MCP tool surface without the local `githits` CLI startup, auth storage, or Commander wiring.

> **Browser boundary:** only the selected `@githits/mcp/tools` resolved runtime
> graph is browser-safe. Installing `@githits/mcp` still installs its MCP SDK
> and other Node-oriented dependencies; the package root and
> `@githits/mcp/client` remain Node entries. The `/tools` entry does not provide
> filesystem access, authentication, configuration discovery, or any other
> host behavior.

## API

- `createMcpServer(options)` creates an MCP server with GitHits tools registered.
- `registerMcpTools(server, options)` registers GitHits tools on an existing MCP server.
- `getMcpToolDescriptors()` returns static tool metadata without requiring concrete services.
- `buildMcpQuickStart(options?)` builds the guide returned by the read-only `quick_start` tool.
- `buildMcpInstructions(options?)` is a deprecated compatibility alias for `buildMcpQuickStart()`.
- `@githits/mcp/client` exports concrete GitHits service implementations, static token providers, URL/config helpers, request-header helpers, the `ServiceDiagnostics` type, and registry helpers for remote MCP servers. Service clients are silent by default; hosts that need operation spans or debug events inject a `ServiceDiagnostics` implementation through their runtime options. Hosts must explicitly opt into sensitive diagnostic areas and own the resulting privacy and retention policy.
- The former module-global telemetry lifecycle helpers (`startTelemetrySpan`, `endTelemetrySpan`, `flushTelemetry`, and `withTelemetrySpan`) are not exported from `@githits/mcp/client`. Remote hosts own diagnostics lifecycle and destinations through injection.
- `@githits/mcp/smoke-test` exports reusable smoke assertions and `runMcpSmoke()` for remote MCP server validation.
- `@githits/mcp/tools` exports the browser-callable `get_example` factory and
  its structural service contract, plus `toCallableTool()` and the stable
  callable result/schema types.

## Browser-callable `@githits/mcp/tools`

The `/tools` entry is a small frontend-facing surface. Inject a service with
only the `search(params, options?)` method, create the existing `get_example`
definition, and adapt it to a plain callable object:

```ts
import {
  createGetExampleTool,
  toCallableTool,
  type GetExampleService,
} from "@githits/mcp/tools";

const service: GetExampleService = {
  search: async ({ query, language, licenseMode }, options) => {
    const response = await fetch("/api/githits/search", {
      method: "POST",
      body: JSON.stringify({ query, language, license_mode: licenseMode }),
      signal: options?.signal,
    });
    return response.text();
  },
};

const tool = toCallableTool(createGetExampleTool(service));
```

`toCallableTool()` wraps the tool's Zod object schema, emits input-mode JSON
Schema, and validates/defaults input before calling the service. The omitted
`format` field remains optional in the schema and defaults to `"text-v1"`.
Unknown object properties follow the normal Zod object behavior. Successful
and structured error results are returned as the serializable `ToolResult`
shape. If the caller supplies an `AbortSignal`, it is forwarded unchanged to
the service; caller cancellation rejects the execution rather than becoming an
error result.

A frontend can add a small registration adapter for its WebMCP host API. The
adapter owns the host-specific registration call and passes its signal through;
the callable surface is not a generic protocol-conversion layer:

```ts
document.modelContext.registerTool({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: tool.annotations,
  execute: (input, options) =>
    tool.execute(input, { signal: options?.signal }),
});
```

The frontend owns `document.modelContext`, authentication and login UI,
request transport, CORS policy, and any user-facing recovery. The injected
service decides how `/api/githits/search` (or another backend boundary) is
authenticated and reached.

The package expects callers to provide service implementations through `McpToolServices` or a request-scoped `McpToolServicesProvider`. GitHits does not populate MCP initialize instructions because hosts expose them inconsistently; `quick_start` owns shared guidance instead. Callers may still pass their own `instructions` explicitly. Use `quickStartOptions` to configure the guide. Servers can pass `traceTool` to `createMcpServer()` or `registerMcpTools()` to wrap public tool execution for instrumentation without receiving arguments or auth data.

Only imports from `@githits/mcp`, `@githits/mcp/client`, `@githits/mcp/smoke-test`, `@githits/mcp/tools`, and `@githits/mcp/package.json` are public. The workspace alias `@githits/mcp/internal` is not exported, is not supported for external consumers, and must not be used by remote MCP server implementations.

Remote MCP servers should provide request-scoped services through `createMcpServer()` and keep transport, auth/session handling, deployment config, and observability outside this package.
