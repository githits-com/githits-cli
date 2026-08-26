# Plan: Browser-callable GitHits tools and WebMCP proof of concept

## Status

Phase 1 is complete and merged through PR #311 at
`9c3b613f7c5ddae2cedb5ec2e8273d5fbe7115b5` on 2026-08-26. Core service
clients accept optional host-supplied `ServiceDiagnostics`; core and MCP have
no diagnostics output implementation; the CLI owns telemetry/debug lifecycle;
MCP error mapping is pure apart from request-local auth-action selection; and
public MCP artifacts are checked for the removed filesystem edge.

The merged implementation passed 3,277 tests, typecheck, formatting, lint,
plugin generation/checks, root and MCP builds, public package validation, and
source and built unauthenticated CLI/MCP smoke suites. The post-merge Main run
also passed on Ubuntu, Windows, Bun, and Node 20/22/24/26. Deployment to `main`
is complete; package publication of the Phase 1 changes is pending because the
source manifests remain at `0.11.0` and its two release fragments remain
unconsumed.

Phase 2 was replanned on 2026-08-26 from browser-target bundle evidence and the
WebMCP draft at commit `2ac94f537214c4b84f55eb03b644198be44289f0`.
Phase 2 is ready for implementation. Later app integration remains
forward-looking because the `app.githits.com` repository is not available in
this workspace.

## Problem and expected outcome

`@githits/mcp` owns useful tool names, descriptions, Zod schemas, handlers, and
MCP registration. Its public root cannot be imported by a browser because it
imports the MCP SDK server and the tool error path imports Node
`AsyncLocalStorage`. The callable tool factories are workspace-private, so an
application cannot select a tool, inject its existing browser service, and
adapt it to `document.modelContext.registerTool()`.

When this effort is complete:

- `@githits/mcp` exposes a browser-callable tool entry whose resolved browser
  graph contains no Node built-ins, Node polyfills, or MCP SDK runtime.
- `app.githits.com` can register `get_example` as a WebMCP tool using its
  existing authenticated browser API/service boundary instead of importing
  CLI or remote-server configuration.
- The Node MCP server continues to register the same tools, schemas,
  descriptions, structured error codes/non-remediation details, request-scoped
  auth guidance, and execution hooks. Host-specific remediation prose may
  differ where the current core message incorrectly assumes a CLI host.

## Verified current state and evidence

### WebMCP contract

The current community-group draft exposes the imperative API at
`document.modelContext.registerTool()`. A tool supplies `name`, `description`,
an optional JSON Schema `inputSchema`, an async `execute(input, { signal })`
callback, and WebMCP annotations. The callback may return any JSON-serializable
value. WebMCP intentionally reuses the MCP tool concept without adopting MCP's
data layer, and standardized MCP-to-WebMCP conversion remains an open proposal.

The first proof of concept therefore needs only a small frontend adapter. It
does not need the MCP SDK in the browser and must not claim a general protocol
conversion. The package-side contract will retain the existing serializable
`ToolResult`; the app adapter may return it unchanged for the proof of concept.

### Resolved browser graphs

Browser-target Bun builds with metafiles produced these results:

| Source entry | Result | Relevant resolved graph |
| --- | --- | --- |
| `packages/mcp/src/index.ts` | Builds only by including browser polyfills | MCP SDK server plus `node:buffer`, `node:crypto`, `node:events`, `node:stream`, and `node:util` |
| `packages/mcp/src/client.ts` | Builds only by including browser polyfills | Broad private-core barrel and the same Node built-ins |
| `packages/mcp/src/tools/get-example.ts` | Builds only by including browser polyfills | `node:async_hooks`, then the broad private-core barrel, PKCE, and request-header crypto |
| `packages/mcp/src/tools/quick-start.ts` | Browser-clean | Tool module and local tool types only |
| `packages/core-internal/src/services/githits-service.ts` | Browser-clean | Fetch, Zod, URL validation, timeout, diagnostics, and neutral errors; no Node built-in |

Every network-backed tool currently reaches the same five Node built-ins
because `packages/mcp/src/tools/shared.ts` imports `node:async_hooks` and error
classifiers import the broad `@githits/core-internal` barrel. This is a graph
shape, not evidence that every tool intrinsically needs Node.

A second browser probe replaced only those two edges: a narrow private-core
export and a non-Node auth-context stand-in. `get_example` then resolved with
no `node:*`, `process`, or `Buffer` edge. Its remaining runtime dependencies
were Zod, browser-standard APIs, neutral GitHits errors, and MCP-owned tool
formatting. This establishes the next extraction seam.

Zod 4.4.3 can produce the required input JSON Schema without another runtime
dependency using `z.toJSONSchema(z.object(shape), { io: "input" })`. The
`io: "input"` option is required: without it, a Zod field with `.default()` is
incorrectly listed as required in the generated schema.

### Package dependency distinction

`@githits/mcp` must retain `@modelcontextprotocol/sdk` for its Node server
entry. Installing `@githits/mcp` therefore still installs the MCP SDK and its
Node-oriented dependency tree. The MCP SDK has no install hook, and package
installation does not make those modules part of a browser runtime graph.

For this proof of concept, compatibility means that the selected packed export
browser-bundles without those dependencies, built-ins, or polyfills. A separate
`@githits/sdk` package is not required to meet that outcome. If product policy
later requires the installed dependency manifest itself to contain no Node
server packages, the exact browser-callable contract can move to
`@githits/sdk`; that would be a package/release-boundary decision, not a browser
runtime fix.

### Ownership findings

- Tool definitions own names, descriptions, schemas, result formatting, and
  calls to injected service interfaces. They do not need an MCP server.
- The MCP server adapter owns request-scoped service resolution, the raw MCP
  SDK callback `extra`, tracing, and host-specific auth remediation.
- `AsyncLocalStorage` exists only so the MCP server can set an `authAction`
  outside a handler and nested error formatting can read it implicitly. No tool
  uses the raw MCP callback `extra`. Explicit tool execution context is the
  correct boundary and also has a place for WebMCP/MCP cancellation signals.
- Browser authentication, session identity, API routing, CORS behavior, and UI
  state belong to `app.githits.com`. The first browser tool should receive an
  app-supplied, search-only `GetExampleService`; it should not implement the
  unrelated language and feedback methods on `GitHitsService`, import
  `@githits/mcp/client`, or make the Node-oriented concrete client the browser
  integration boundary.
- `mapGitHitsServiceError()` currently imports the code-navigation classifier
  only to reuse the mapped-error type and terms-acceptance mapping. That pulls
  the entire code-navigation error taxonomy into `get_example`; the shared
  error contract and terms mapper should be independent.
- `TermsAcceptanceRequiredError` still embeds the CLI command
  `githits settings terms accept` in its core message. `get_example` can reach
  that error in a browser. Core should retain the neutral signal and URLs while
  CLI/MCP/frontend adapters own host-appropriate remediation prose.

## Decisions

1. Add a public `@githits/mcp/tools` subpath for browser-callable tool code.
   Keep the existing root, `client`, and `smoke-test` entrypoints unchanged.
2. Prove the seam with `get_example`, the smallest useful network-backed tool.
   `quick_start` alone is already browser-clean but cannot prove injected API
   execution.
3. Accept install-time MCP SDK dependencies for this proof of concept; reject
   any MCP SDK or Node runtime edge in the packed `/tools` browser graph.
4. Keep the WebMCP DOM registration adapter in the frontend. The package will
   expose a validated callable tool with plain JSON Schema, avoiding a runtime
   dependency on the experimental WebMCP API or `webmcp-types`.
5. Return the existing JSON-serializable `ToolResult` from the proof-of-concept
   WebMCP callback. Do not invent a general MCP/WebMCP error or content
   conversion while the standards proposal is unresolved.
6. Pass auth remediation, terms remediation, and cancellation through explicit
   execution context; remove `AsyncLocalStorage` instead of polyfilling it.
7. Use a narrow private-core browser entry for the verified tool graph. Do not
   move PKCE, environment config, request-header discovery, or unrelated
   formatters until a selected browser tool actually reaches them.

## Scope

### In scope

- A browser-neutral callable-tool contract and JSON Schema conversion.
- Public package access to the `get_example` callable tool.
- Explicit auth/terms remediation and abort-signal execution context across the
  existing MCP tool adapter.
- A narrow private-core export for browser-reachable service types and neutral
  error classes.
- Source, built, packed-package, browser-graph, and Node MCP regression tests.
- Permanent package/tool architecture documentation and an MCP release
  fragment.
- A later `app.githits.com` WebMCP proof of concept after switching to that
  repository.

### Non-goals

- Making the public `@githits/mcp` root or `@githits/mcp/client` browser-safe.
- Removing Node-oriented packages from the `@githits/mcp` installation tree.
- Publishing `@githits/sdk` before a verified package-policy need exists.
- Browser-enabling all code-navigation and package-intelligence tools in the
  first increment.
- Redesigning MCP result envelopes or claiming generic MCP-to-WebMCP
  conversion.
- Reimplementing app authentication, copying tokens into tool configuration,
  or bypassing existing app authorization and CORS boundaries.

## Target architecture

```text
app.githits.com
  existing authenticated browser API/service
        │ implements GetExampleService.search()
        ▼
@githits/mcp/tools
  createGetExampleTool(service)
        │ ToolDefinition: metadata + Zod shape + handler
        ▼
  toCallableTool(definition)
        │ JSON Schema + validated execute(input, { signal })
        ▼
frontend adapter
  document.modelContext.registerTool({
    name, description, inputSchema, annotations, execute
  })

@githits/mcp (Node entry)
  MCP SDK server adapter
        │ resolves request-scoped services and ToolExecutionContext
        ▼
  the same ToolDefinition handler
```

### Contracts

- `ToolExecutionContext` contains optional `authAction`, a single optional
  `termsRemediation` object with `message` and `action`, and `signal`. It
  contains no raw MCP SDK object and no browser-global reference.
- `ToolHandler<TArgs>` receives typed arguments plus
  `ToolExecutionContext`. Existing direct callers may omit the context.
- Error helpers receive execution context explicitly when selecting auth
  remediation. Existing auth actions remain byte-for-byte compatible. Terms
  errors retain their codes, retryability, and canonical URLs while each host
  owns appropriate remediation prose instead of inheriting a CLI command from
  core.
- The tool/MCP default terms action points to the mapped `acceptanceUrl`, which
  is usable by hosted remote MCP and browser callers. Root CLI commands add the
  existing CLI command in terminal/JSON formatting, and local stdio MCP passes
  the existing message and action as one `termsRemediation` value; those two
  local outputs remain byte-for-byte compatible.
- `toCallableTool(definition)` wraps the raw Zod shape in `z.object()`, emits
  input-mode JSON Schema, validates/defaults unknown input through the same Zod
  schema before calling the handler, and forwards the abort signal.
- The public tool surface owns a purpose-specific `GetExampleService` with
  only `search(params, options?)`. Its parameter and request-option shapes are
  public structural types, so an existing `GitHitsService` satisfies it without
  leaking `@githits/core-internal` through declarations.
- The underlying `GitHitsService.search()` accepts the same optional
  browser-standard request options containing `signal`.
  `GitHitsServiceImpl` passes it into fetch, and `RefreshingGitHitsService`
  forwards it through both the first attempt and any token-refresh retry. Node
  callers that omit the option behave unchanged.
- Caller cancellation remains cancellation: a caller-signal abort is not
  translated to `TIMEOUT` or a structured tool error. The fetch timeout keeps
  its existing `TIMEOUT` mapping. An already-aborted operation cannot trigger
  token refresh or retry.
- The `/tools` declaration surface defines annotations structurally and must
  not import MCP SDK types. The Node adapter relies on structural compatibility
  when registering them with the SDK.

### Migration end state

The existing Node MCP API remains source-compatible. Tool behavior lives once
and is callable through either adapter. Only the selected browser entry is
compatibility-gated. If a future SDK split is required, it receives this
already-neutral contract while `@githits/mcp` becomes its Node MCP adapter;
the frontend contract does not need another redesign.

## Assumptions and unknowns

### Overall assumptions

- The proof-of-concept requirement is a browser-clean resolved runtime graph,
  not a Node-free npm installation tree. Evidence: Node dependencies are not
  reachable from the selected entry after the two verified seams are removed.
- `app.githits.com` has, or can provide, an authenticated implementation of the
  narrow `GetExampleService.search()` contract without exposing credentials to
  tooling or chat. This must be verified in the app repository before its
  integration phase.
- The initial browser target is the current WebMCP implementation generation:
  Chrome 149 origin trial or Edge 150 origin trial in a secure context.

### Later-phase unknowns

- App bundler, TypeScript DOM typing, feature-flag, and deployment conventions.
  Resolve from the app repository before detailing Phase 3.
- Whether the app's existing API path is same-origin or its cross-origin API
  already permits the required authenticated request. Resolve with app code and
  non-secret browser/network evidence before Phase 3 implementation.
- Whether install-time dependency-tree purity becomes a product requirement.
  Resolve by product decision no later than the Phase 3 reorientation; only a
  `yes` justifies a separate public SDK package.

## Phase map

### Phase 1 — host-owned diagnostics and no filesystem edge (`COMPLETE`)

Core and MCP are silent, filesystem-free service/tool layers while the CLI owns
diagnostics output and lifecycle. Merged in PR #311 with the verification
record above.

### Phase 2 — packed browser-callable `get_example` seam (`READY`)

A consumer can import a validated callable `get_example` from the packed
`@githits/mcp/tools` entry, inject a service, execute it with an abort signal,
and browser-bundle it with no Node or MCP SDK runtime edge. The Node MCP server
retains current behavior.

### Phase 3 — `app.githits.com` WebMCP registration (`PLANNED`)

The app registers and invokes the shared `get_example` tool through
`document.modelContext` using its current authenticated browser service and an
explicit experimental-browser gate. Tactical detail will be added after Phase
2 merges and the plan is reoriented in the app repository.

## Phase 2 detailed implementation plan

### Status

`READY`

### Expected outcome

The published package contains one useful browser-callable GitHits tool surface
with shared metadata, schema, validation, handler, cancellation, and error
behavior. Node hosts continue using the existing root API with no setup change
and the same structured behavior, apart from the explicitly documented move to
host-owned terms-remediation prose.

### Assumptions

- A single network-backed tool is sufficient to prove the boundary.
- Zod remains the only runtime dependency reachable from the public `/tools`
  entry; private core source is bundled into the package artifact.
- Existing tool result envelopes are valid WebMCP proof-of-concept return
  values because they are JSON-serializable.

### Unknowns or product decisions

None for Phase 2.

### Dependencies

- Existing `GitHitsService`/`RefreshingGitHitsService` implementations and
  `get_example` tool tests.
- Existing MCP server auth-action public contract, terms-error behavior, and
  execution hooks.
- Existing public-package validator and Bun browser build metafiles.

### Affected components and likely files

- Tool context and result contracts:
  `packages/mcp/src/tools/types.ts`, `packages/mcp/src/tools/shared.ts`, and tool
  handlers that format mapped errors.
- Shared error taxonomy:
  `packages/mcp/src/shared/code-navigation-error-map.ts`,
  `packages/mcp/src/shared/githits-service-error-map.ts`, all other mapper
  consumers, `packages/mcp/src/internal.ts`, and a new small shared mapped-error
  module.
- Private browser-neutral core boundary:
  `packages/core-internal/src/browser.ts`, its private package export, and root
  TypeScript path aliases.
- Selected callable surface:
  `packages/mcp/src/tools/get-example.ts`, a new public tools entry, MCP package
  exports/build entries, and declarations.
- Cancellation:
  `packages/core-internal/src/services/githits-service.ts`,
  `packages/core-internal/src/services/refreshing-githits-service.ts`, shared
  fetch/refresh helpers where required, and their tests.
- Local terms presentation:
  `src/commands/format-mapped-error.ts`, affected CLI terminal/JSON tests, and
  the root local-stdio MCP setup that supplies its CLI-specific
  `termsRemediation`.
- Artifact validation and durable documentation:
  `scripts/validate-public-packages.ts`, `packages/mcp/README.md`,
  `docs/implementation/workspace-packages.md`,
  `docs/implementation/tools.md`, and one independent change fragment.

### Ordered implementation

1. Extract the transport-neutral `MappedError` contract and terms-acceptance
   classifier from the code-navigation-specific mapper. Preserve structured
   codes, retryability, and canonical URLs while allowing the GitHits REST
   mapper to avoid loading the code-navigation error taxonomy. Repoint every
   mapper consumer and preserve the workspace-only `@githits/mcp/internal`
   re-export used by the transitioning root CLI. Make the core terms error and
   shared mapped error host-neutral: neither owns `details.action`. Add the
   existing CLI command in root terminal/JSON presentation and local stdio MCP,
   while the tool/MCP default uses `acceptanceUrl` for hosted/browser contexts.
   Assert each intended host output explicitly; local CLI and stdio MCP stay
   byte-for-byte compatible, while remote/browser contexts intentionally stop
   receiving CLI-only prose.
2. Replace MCP `AsyncLocalStorage` with explicit `ToolExecutionContext`.
   Thread the context from MCP registration into tool handlers and error-result
   helpers. Preserve request-scoped service resolution, `traceTool`, custom
   string/function `authAction`, default action text, and concurrent server
   isolation. Add one optional public `termsRemediation` server option carrying
   the paired message/action; root local stdio supplies the exact current pair
   and hosted servers may use the URL-based default. Forward the MCP SDK
   callback's `extra.signal` without exposing the rest of `extra` to tools.
3. Add the narrow private-core browser entry and point browser-reachable tool
   types/error imports at it. It exports only the service contract and neutral
   runtime errors required by the selected callable graph. It does not export
   PKCE, environment resolution, request-header discovery, or private package
   references into public declarations.
4. Add shared optional request options containing `signal` to
   `GitHitsService.search()`. Pass the signal through `GitHitsServiceImpl` to
   fetch and through `RefreshingGitHitsService` on both the initial and
   refreshed-token attempts. Before refresh/retry, respect an aborted signal;
   do not refresh credentials for cancelled work. Distinguish a supplied
   signal's abort reason/`AbortError` from `FetchTimeoutError`: propagate the
   former and retain the existing timeout mapping for the latter.
5. Add the purpose-owned public `GetExampleService`, `toCallableTool()`, and the
   `/tools` entry. `GetExampleService` exposes only the structurally compatible
   `search(params, options?)` method and no private-core declaration import.
   The helper emits an input-mode JSON Schema, validates/defaults input with
   Zod before execution, and forwards explicit context. Initially export only
   the stable types and `get_example` factory needed by the proof of concept;
   do not expose the full internal tool barrel.
6. Extend the MCP package build and export map without changing existing
   entrypoints. Resolve all private-core declarations and ensure the new public
   declaration surface has no MCP SDK type import.
7. Extend external packed-package validation with a browser-target consumer of
   `@githits/mcp/tools`. Inspect its metafile and generated output, failing on
   `node:*`, MCP SDK runtime, `process`, `Buffer`, `AsyncLocalStorage`, private
   aliases, workspace ranges, or injected Node polyfills. Invoke the callable
   tool with a mocked service and abort signal in a separate consumer check.
8. Update permanent package/tool documentation and add the required MCP
   release fragment. Do not claim that the root/client entries or the npm
   installation tree are browser-only.

### Edge cases and failure behavior

- Zod defaults remain optional in generated input JSON Schema and are applied
  before the handler runs.
- Empty/invalid `query` input fails validation before the service is called.
- Service auth, rate-limit, timeout, terms, and unknown failures retain their
  existing structured `ToolResult` fields. Browser-reachable terms failures do
  not instruct the user to run a CLI command; they retain the canonical terms
  and acceptance URLs for frontend remediation.
- Hosted MCP defaults to URL-based terms guidance. Local CLI and local stdio
  MCP keep their current command guidance through explicit host formatting.
- Concurrent calls with different host `authAction` functions cannot observe
  each other's action because context is explicit.
- An aborted WebMCP/MCP call reaches the injected service/fetch signal, rejects
  as cancellation rather than returning an error `ToolResult`, and cannot
  start a token refresh or retry. An internal fetch deadline still returns the
  existing structured `TIMEOUT` result. No timer, polling, or fallback
  cancellation mechanism is added.
- A Node MCP `traceTool` hook observes caller cancellation as a rejected
  execution, matching the handler contract rather than a synthetic successful
  error result.
- The browser entry cannot import descriptor creation through the Node MCP
  server merely to obtain metadata; it constructs the selected definition
  directly from the injected service.

### Test and verification strategy

- Unit-test mapped-error extraction and explicit auth-action behavior,
  including concurrent calls and defaults.
- Unit-test neutral core terms messages and host-specific CLI/MCP remediation
  so moving the prose does not silently remove actionable guidance. Assert
  byte-identical existing local CLI/local stdio output and URL-based default
  hosted/browser output, including terminal and JSON envelopes.
- Unit-test JSON Schema conversion for required fields, optional fields,
  defaults, descriptions, enums, and additional-property behavior.
- Unit-test callable execution validation, default application, successful
  result parity, structured errors, and observable abort rejection with a
  search-only `GetExampleService` mock.
- Unit-test `GitHitsServiceImpl` signal forwarding at the fetch interface and
  distinguish caller abort from deadline timeout.
- Unit-test `RefreshingGitHitsService` forwarding the same signal through the
  initial and refreshed-token attempts, plus no refresh/retry once aborted.
- Unit-test the error wrapper rethrows a matching caller cancellation instead
  of converting it to a structured tool error.
- Run targeted MCP public-surface, server, tool, and core service suites.
- Run `bun test`, typecheck, format check, lint, root build, MCP build,
  `bun run validate:packages`, source/built CLI smoke, and source/built MCP
  smoke.
- Run a browser-target build of the packed `/tools` consumer and retain its
  import-graph assertion as a deterministic CI gate.
- Tool descriptions and normal agent behavior are unchanged. The intentional
  error-remediation prose changes are covered by focused unit and smoke
  assertions, so `agent:e2e` is not required unless implementation changes the
  descriptions or broader agent behavior.

### Documentation

- Document `/tools` as browser-callable with an injected service and a small
  frontend WebMCP adapter.
- Document that root/client remain Node entries and MCP SDK dependencies are
  still installed.
- Update the durable tool architecture to distinguish tool execution context
  from raw MCP callback context.

### Acceptance criteria

- A packed external consumer imports only `@githits/mcp/tools`, creates
  `get_example` with a search-only mock `GetExampleService`, converts it to the
  callable form, and receives the same successful and structured error results
  as the Node tool path.
- Invalid input is rejected before the service call, and omitted `format`
  remains optional in the emitted JSON Schema and defaults during execution.
- The packed consumer's browser graph and output contain no Node built-in,
  Node polyfill, MCP SDK runtime, `process`, `Buffer`, `AsyncLocalStorage`,
  private workspace alias, or `workspace:*` reference.
- MCP custom/default auth actions, concurrent request isolation, service
  provider resolution, tracing, caller cancellation, refresh-decorator signal
  forwarding, no-refresh-after-abort, and timeout behavior are covered and
  pass.
- Browser-reachable errors contain no CLI-only command/environment guidance;
  terms codes, retryability, and canonical URLs remain stable, and each Node
  CLI/MCP/browser host presents explicitly tested, appropriate remediation.
- Root CLI and local stdio MCP terms output remains byte-for-byte compatible,
  hosted MCP defaults to acceptance-URL guidance, and the workspace-only
  internal mapped-error re-export remains available to root transition code.
- Existing root, client, and smoke-test package entrypoints remain compatible;
  full validation and smoke suites pass.
- Permanent docs describe the real compatibility boundary and a valid release
  fragment records the public MCP package impact.

## Phase 3 outline

### Status

`PLANNED`; not ready until Phase 2 merges and the app repository is available.

### Expected outcome

On a supported experimental browser, `app.githits.com` exposes `get_example`
through WebMCP and a browser agent can invoke it using the signed-in user's
existing application authority. Unsupported browsers retain normal app
behavior without errors or misleading compatibility claims.

### Assumptions

- The app has a secure-context deployment and a supported origin-trial or
  experimental-browser setup.
- The app can implement the narrow injected service through its existing API
  layer without creating or exposing a new credential path.

### Unknowns or product decisions

- Exact app integration module, bundler, feature gate, auth/CORS path, and UI
  observability. Resolve from app code before implementation.
- Whether the tool should be registered globally or only on a specific app
  route/state. Requires app product context.
- Whether install-time dependency-tree purity is required. If yes, replan the
  already-neutral `/tools` contract into `@githits/sdk` before app rollout.

### Dependencies

- Merged Phase 2 public package release.
- Access to the `app.githits.com` repository and its non-secret local test
  environment.
- Chrome 149 or Edge 150 WebMCP experimental support, or the then-current
  implementation status after reorientation.

### Acceptance criteria

- The app registers exactly one `get_example` tool only when WebMCP is
  available and unregisters/cleans it up with the owning page lifecycle.
- The registered metadata and JSON Schema match the shared package definition;
  returned content preserves current GitHits provenance and guardrails.
- A real browser invocation reaches the app's existing authenticated API path,
  cancellation aborts the request, and auth/rate-limit/terms failures remain
  usable by the agent without exposing credentials.
- Unsupported browsers and ordinary human app workflows are unchanged.
- App documentation records the experimental support and its browser/version
  gate; no general cross-browser claim is made.

Tactical files, test commands, and rollout steps will be added only after the
Phase 2 boundary reorientation and app code exploration.

## Cross-cutting considerations

### Security

- Never accept tokens, cookies, OAuth codes, or credentials through tool
  arguments or test fixtures. The frontend adapter uses existing app authority.
- Preserve tool guardrails and mark `get_example` output as untrusted content
  in the app's WebMCP annotations because it contains external repository
  material.
- Browser registration must be feature-detected and scoped to the owning
  document lifecycle. No silent remote MCP bridge is introduced.

### Compatibility and migration

- Existing public entrypoints and successful handler results remain
  compatible. Structured error codes, retryability, non-remediation details,
  and canonical URLs remain stable; host remediation text/action may
  intentionally change where the previous core string gave CLI-only
  instructions to non-CLI hosts.
- `/tools` is additive and pre-1.0. Its release fragment should record the
  appropriate `@githits/mcp` SemVer impact. The root CLI implementation is
  touched only to preserve its current output and therefore needs no root
  fragment; if implementation changes any root-visible output or public
  artifact, add the required independent root `githits` fragment.
- A later SDK split is mechanically possible because the browser contract is
  isolated, but it is not part of this plan without a package-policy decision.

### Performance

This work does not optimize a measured runtime path. Bundle byte size is
reported as diagnostic evidence but is not an optimization target. The only
bundle requirement is absence of forbidden runtime edges/polyfills.

### Rollback

The new subpath and app registration are additive. Before app rollout, rollback
is removal of the app import/registration. Existing Node MCP entrypoints do not
depend on the app adopting WebMCP.

## Phase-boundary reorientation

After each phase merges, run `$next-steps` against refreshed `origin/main`.
Record merged evidence, re-run the packed browser graph, re-check the current
WebMCP draft/implementation status, and detail only the next phase. Before
Phase 3, switch to the app repository and verify its architecture instead of
copying assumptions from this repository.

## Completion and plan cleanup

The effort is complete when the app proof of concept meets Phase 3 acceptance,
the shared tool and browser boundary are documented permanently, and no accepted
review finding remains. Transfer final architecture, compatibility, and app
integration facts to `docs/implementation/` in the owning repositories, then
delete this temporary plan rather than leaving a stale roadmap.
