# @githits/mcp

Reusable MCP server APIs and tool registrations for GitHits.

This package exposes transport-neutral helpers for servers that want the GitHits MCP tool surface without the local `githits` CLI startup, auth storage, or Commander wiring.

The production server at `https://mcp.githits.com` lives in the separate
`remote-mcp` repository and consumes a released version of this package for
tool registration, descriptors, `quick_start`, and tool logic. That host owns
HTTP transport, request-scoped service composition, auth/session handling,
deployment, and observability; package behavior reaches it after a dependency
update and deployment rather than through a parallel implementation.

> **Browser boundary:** only the selected `@githits/mcp/tools` resolved runtime
> graph is browser-safe. Installing `@githits/mcp` still installs its MCP SDK
> and other Node-oriented dependencies; the package root and
> `@githits/mcp/client` remain Node entries. The `/tools` entry does not provide
> filesystem access, authentication implementation or storage, configuration
> discovery, or any other host behavior.

## Stable Research

The public inventory includes `research` by default. It answers one question
about a public package or repository with a verified, source-cited answer, can
identify the target from the question, and continues threads by `thread_id`.
Answers can take a few minutes; `AgenticAskServiceImpl` applies a 210-second
deadline (`AGENTIC_ASK_REQUEST_TIMEOUT_MS`) and honors the MCP request's abort
signal. Hosts should keep their request and MCP client timeouts above that
deadline, or pass a lower `timeoutMs`.

Providers must now supply `agenticAskService: AgenticAskService`. Import
`AgenticAskServiceImpl` and its request/response/runtime contracts from
`@githits/mcp/client`; construct it with the GitHits REST API base (the same
`apiUrl` used by `GitHitsServiceImpl`), the request's token provider, and the
request's client headers and user agent. The browser-callable factory
`createResearchTool` and `ResearchMcpArgs` are exported from
`@githits/mcp/tools`. Rate limits map to `RATE_LIMITED`: the short-term limit
is retryable after `retryAfterSeconds`, while the daily limit sets
`details.rateLimitScope: "daily"` and is not retryable before 00:00 UTC. Hosted
MCP must adopt and deploy the released package before its clients receive the
tool.

## Stable Target Resolution

The public inventory includes `resolve_target` by default. It ranks fuzzy public
package, repository and documentation-site names using the existing backend
resolver. Canonical targets go directly to the next tool; confidence, ambiguity
and malicious-content status govern continuation. This does not establish
vulnerability-free or upgrade-safe status.

Providers must now supply `resolveTargetService: ResolveTargetService`. Import
`ResolveTargetServiceImpl` and its service/request/result contracts from
`@githits/mcp/client`; construct it with the existing OSS endpoint and the
request's token provider, headers and optional diagnostics. The browser-callable
factory and `ResolveTargetMcpArgs` are exported from `@githits/mcp/tools`.
No private core or workspace-internal imports are needed. Hosted MCP must adopt
and deploy the released package before its clients receive the tool.

## Stable Source Diff

The public tool inventory includes `code_diff` by default. It compares raw
repository trees across exact package versions or public repository refs;
package addressing does not filter to a package subdirectory. Defaults are
bounded name-status inventory and text, with scoped stats/patches available.
Truncation and content-safety limits remain evidence limits; a diff does not
establish upgrade compatibility.

Custom service providers must supply `codeNavigationService` implementing both
`CodeNavigationService` and `CodeDiffService`. Import those contracts from
`@githits/mcp/client`; the built-in `CodeNavigationServiceImpl` already
implements both. Providers implementing only navigation must add `codeDiff`
before adopting this package version. The standalone `CodeNavigationService`
interface remains unchanged. The separate hosted server must adopt and deploy
the released package before hosted clients receive the tool.

## API

- `createMcpServer(options)` creates an MCP server with GitHits tools registered.
- `registerMcpTools(server, options)` registers GitHits tools on an existing MCP server.
- `getMcpToolDescriptors()` returns static tool metadata without requiring concrete services.
- `buildMcpQuickStart(options?)` builds the guide returned by the read-only `quick_start` tool.
- `buildMcpInstructions(options?)` is a deprecated compatibility alias for `buildMcpQuickStart()`.
- `@githits/mcp/client` exports GitHits service types and implementations, including `ReadService` and `ReadServiceImpl`, static token providers, URL/config helpers, request-header helpers, the `ServiceDiagnostics` type, and registry helpers for remote MCP servers. Service clients are silent by default; hosts that need operation spans or debug events inject a `ServiceDiagnostics` implementation through their runtime options. Hosts must explicitly opt into sensitive diagnostic areas and own the resulting privacy and retention policy.
- The former module-global telemetry lifecycle helpers (`startTelemetrySpan`, `endTelemetrySpan`, `flushTelemetry`, and `withTelemetrySpan`) are not exported from `@githits/mcp/client`. Remote hosts own diagnostics lifecycle and destinations through injection.
- `@githits/mcp/smoke-test` exports reusable smoke assertions and `runMcpSmoke()` for remote MCP server validation.
- `@githits/mcp/tools` exports the browser-callable `get_example` factory and
  its structural service contract, plus `toCallableTool()` and the stable
  callable result/schema types. It also exports the neutral
  `AuthenticationError`, `ApiRateLimitError`, `FetchTimeoutError`, and
  `TermsAcceptanceRequiredError` constructors used by the callable error
  boundary.

## Browser-callable `@githits/mcp/tools`

The `/tools` entry is a small frontend-facing surface. Inject a service with
only the `search(params, options?)` method, create the existing `get_example`
definition, and adapt it to a plain callable object:

```ts
import {
  createGetExampleTool,
  toCallableTool,
  type GetExampleRequestOptions,
  type GetExampleSearchParams,
  type GetExampleService,
} from "@githits/mcp/tools";

// Supplied by the application; it owns transport, authentication, and CORS.
declare function searchExamples(
  params: GetExampleSearchParams,
  options?: GetExampleRequestOptions,
): Promise<string>;

const service: GetExampleService = {
  search: (params, options) => searchExamples(params, options),
};

const tool = toCallableTool(createGetExampleTool(service));
```

`toCallableTool()` wraps the tool's Zod object schema, emits input-mode JSON
Schema, and validates/defaults input before calling the service. The omitted
`format` field remains optional in the schema and defaults to `"text"`. The only format values are `"text"` and `"json"`.
Unknown object properties follow the normal Zod object behavior. Successful
and structured error results are returned as the serializable `ToolResult`
shape. If the caller supplies an `AbortSignal`, it is forwarded unchanged to
the service; caller cancellation rejects the execution rather than becoming an
error result.

An injected browser service should throw one of the exported neutral error
constructors when it wants `get_example` to return a structured
`AUTH_REQUIRED`, `REAUTH_REQUIRED`, `RATE_LIMITED`, `TIMEOUT`, or `TERMS_ACCEPTANCE_REQUIRED`
`ToolResult`. This is an explicit thrown-error contract, not automatic HTTP
response classification. Callable authentication remediation is host-neutral:
`Authenticate with GitHits, then retry.` Terms errors use the canonical
`acceptanceUrl` action. Other errors remain `UNKNOWN`.

`ProviderReauthenticationRequiredError` is exported from `/tools` and `/client`.
Example search and Research map it to `REAUTH_REQUIRED` with `retryable: false`.
`details.action` provides sign-in guidance; `details.reauthUrl` contains a validated
sign-in link when available. Complete sign-in before retrying the request.

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

The frontend owns `document.modelContext`, authentication and login UI, its
response-to-error conversion, request transport, CORS policy, and any
user-facing recovery. The injected service decides how the app-owned backend
boundary is authenticated and reached.

The package expects callers to provide service implementations through `McpToolServices` or a request-scoped `McpToolServicesProvider`. `McpToolServices.readService` is required for the advertised compact `read` tool; remote hosts should construct the `ReadServiceImpl` instance per request with that request's endpoint, token, headers, fetch function, and diagnostics. GitHits does not populate MCP initialize instructions because hosts expose them inconsistently; `quick_start` owns shared guidance instead. Callers may still pass their own `instructions` explicitly. Use `quickStartOptions` to configure the guide. Servers can pass `traceTool` to `createMcpServer()` or `registerMcpTools()` to wrap public tool execution for instrumentation without receiving arguments or auth data.

Servers can pass an optional `progress` hook to `createMcpServer()` or `registerMcpTools()` to forward live status for `research` and `get_example`. It is used only when the client sends a progress token (including `0`); updates become `notifications/progress` and stop before the tool returns. `RelayReceiver` is the bundled hook: it receives GitHits operation progress over one shared WebSocket, authorized either by the caller's own GitHits token (`{ kind: "caller", getToken }`) or by a service credential supplied at runtime (`{ kind: "service", serviceId, key }`). The package ships no credentials. Calls never wait for the progress connection: the receiver chooses its relay ID locally and connects in the background, so updates published before it is ready are skipped. Progress is best effort: if it is unavailable or rejected, the tool runs unchanged, resending a rejected request once without progress, and the final result is always authoritative. Call `close()` on shutdown. With a `progress` hook, messages are also animated locally with the GitHits narrowing mark (`narrowingFrame` / `narrowingText`); set `progressAnimation: false` to disable it or `{ intervalMs }` to change the frame rate. Frames are generated by the MCP server and sent only to that call's client.

Network-backed tools forward the MCP request's abort signal to their service call as an optional trailing `ServiceRequestOptions` argument (`{ signal }`), so a cancelled call or closed connection aborts the backend request. The bundled service implementations behind these tools honor it; custom service implementations should forward `options?.signal` to their own requests. Calls without a signal keep their single-argument shape.

Only imports from `@githits/mcp`, `@githits/mcp/client`, `@githits/mcp/smoke-test`, `@githits/mcp/tools`, and `@githits/mcp/package.json` are public. The workspace alias `@githits/mcp/internal` is not exported, is not supported for external consumers, and must not be used by remote MCP server implementations.

Remote MCP servers should provide request-scoped services through `createMcpServer()` and keep transport, auth/session handling, deployment config, and observability outside this package.
