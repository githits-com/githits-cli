# P0/P1 Quality Review Implementation Plan

## Scope

This plan covers the P0 and P1 findings in
`quality-review-2026-07-15.md`, reviewed against commit `77509b2` (post PR
#221, version 0.6.2) on 2026-07-15.

Targeted baseline verification is green: 206 tests pass across the existing
CLI error, login, REST service, auth service, token manager, auth storage,
migration, config, and command suites.

## Status

- PR 1 implemented and fully verified in the worktree; pending review/landing.
- PR 2 and PR 3 remain pending.

## PR Decision

Do not implement all seven findings in one PR. The combined change crosses the
root CLI bootstrap, the public `@githits/mcp/client` runtime, OAuth, token
refresh, filesystem semantics, smoke harnesses, and GitHub Actions. A single PR
would be difficult to review and would make regressions hard to bisect.

Two PRs are technically possible, but still combine unrelated security/storage
work with CI harness work. The recommended split is three PRs:

1. **Network and CLI failure safety:** P0.1, P0.3, P1.1, and P1.3.
2. **Credential persistence safety:** P0.2 and P1.4.
3. **Built-artifact product smoke in CI:** P1.2.

This is the smallest split that keeps each PR cohesive. PR 1 owns network
boundaries and user-visible errors. PR 2 owns credential retention and local
storage. PR 3 changes only test infrastructure and CI, after the runtime fixes
it should protect are present.

PR 1 and PR 2 can be developed in parallel from the same baseline. Land both
before PR 3 so the new CI gate validates the intended final runtime behavior.

If work must be limited to two PRs, merge PR 3 into PR 2, but keep the commits
separate and land the runtime/storage commits before the smoke/CI commit. Do not
collapse everything into one PR.

## Verified Corrections

- OAuth requests use `FetchTimeoutError`; tests should also cover `AbortError`
  defensively because injected/custom fetch implementations can still throw it.
- `auth status` refresh transport failures are caught by `TokenManager`; the
  actual P0 behavior is deletion of valid refresh credentials after a transient
  failure.
- Production logout suppresses `KeychainUnavailableError`, but other storage
  and MCP startup errors still reach the global CLI boundary.
- `GITHITS_DEBUG=1` is not an existing convention. Use the current scoped
  convention (`GITHITS_DEBUG=cli` or `GITHITS_DEBUG=*`) for stack output.
- URL validation cannot run during generic command registration or local-only
  operations. Repository architecture explicitly requires malformed network
  configuration not to break no-network paths. Validate network-facing URL
  resolution while retaining a non-validating path only for diagnostics and
  auth-storage key cleanup.
- The smoke scripts currently hard-code `bun run dev`; there is no existing
  invocation that exercises `dist/cli.js` under Node.

## Assumptions

- Public production service defaults remain unchanged.
- Plain HTTP remains supported only for exact loopback hosts: `localhost`,
  `127.0.0.1`, and `[::1]`/`::1` after URL parsing.
- `PKGSEER_URL` remains a supported legacy fallback and receives the same URL
  validation as `GITHITS_CODE_NAV_URL`.
- Existing OAuth terminal classification remains authoritative:
  `invalid_grant` and `invalid_client` may clear credentials; transport,
  timeout, and 5xx failures may not.
- Existing token refresh locking, compare-and-swap behavior, and storage
  decorator structure are not redesigned.
- Smoke CI remains unauthenticated and must not require secrets or a live
  backend.
- Release version changes are handled by the normal release process. PRs that
  alter `@githits/mcp/client` behavior must be called out as MCP-package-visible.

## PR 1: Network And CLI Failure Safety

### 1. Establish a safe HTTP error-detail contract

- Add one small shared parser under `packages/core-internal/src/shared/` that
  accepts only known string fields from JSON error bodies, normalizes control
  characters to one line, and bounds displayed detail.
- Never fall back to an HTML/plain-text response body. Empty, malformed, or
  unrecognized bodies produce status-specific generic messages.
- Keep transport classification service-specific. Do not introduce a generic
  HTTP client abstraction or reuse the GraphQL-specific transport.

Tests:

- JSON `detail` is surfaced.
- HTML/plain text is not surfaced.
- Multiline or oversized detail is normalized and bounded.

### 2. Fix REST service transport and response handling (P0.3)

Files centered on:

- `packages/core-internal/src/services/githits-service.ts`
- `packages/core-internal/src/services/githits-service.test.ts`
- `src/commands/example.test.ts`
- `src/commands/languages.test.ts`
- `src/commands/feedback.test.ts`

Implementation:

- Route all four REST calls through one private fetch wrapper that catches only
  transport failures around `fetchWithTimeout`.
- Convert `FetchTimeoutError` and defensive `AbortError` cases to a timeout
  message.
- Convert native-fetch `TypeError` failures to a connection message that names
  `GITHITS_API_URL` as the custom-endpoint check.
- Preserve the original error as `cause` where supported.
- Keep 401 as `AuthenticationError` and 403 as access denied.
- Return a dedicated 429 rate-limit message.
- Format 404/default/5xx errors from status plus parsed JSON detail only. A 5xx
  without safe detail becomes `Server error (<status>). Try again shortly.`
- Add Zod validation for successful `getLanguages` and `searchLanguages`
  payloads. This is the adjacent P3.4 boundary gap and is minor enough to fix
  with P0.3 rather than leave another unchecked REST path. Keep these schemas
  internal to the REST service; do not couple them to MCP tool-input schemas.
- Keep command output mode-correct: text mode emits readable stderr and
  `--json` emits the documented mapped error envelope for generic failures.

Tests:

- Service tests for 500 HTML, 500 JSON detail, 404 JSON detail, 429,
  `FetchTimeoutError`, `AbortError`, `TypeError`, and malformed language data.
- Replace tests that currently require raw 5xx body propagation.
- For each of `example`, `languages`, and `feedback`, assert rendered stderr for
  a sanitized 500-HTML error and an offline error.
- Add JSON-mode generic-error assertions for `languages` and `feedback` so the
  existing CLI/MCP parity contract is not violated.

### 3. Enforce secure network endpoint resolution (P1.1)

Files centered on:

- `packages/core-internal/src/services/config.ts`
- `packages/core-internal/src/services/config.test.ts`
- `src/container.ts`
- command registration paths that currently resolve URLs for help output
- `docs/implementation/config.md`

Implementation:

- Add a pure URL validator in `config.ts` that reports the offending variable,
  rejects malformed values and non-HTTPS schemes, and permits HTTP only for the
  exact loopback hosts listed in the assumptions.
- Apply it consistently to `GITHITS_MCP_URL`, `GITHITS_API_URL`,
  `GITHITS_CODE_NAV_URL`, and legacy `PKGSEER_URL`, preserving current override
  precedence.
- Keep defaults independent; do not derive one service URL from another.
- Do not resolve/validate service URLs merely to register commands. Search,
  code, package, and docs commands are always available and can resolve their
  dependencies when invoked.
- Remove the unused API URL from auth-only dependency construction.
- Give local-only auth cleanup/diagnostics paths a narrowly named raw MCP URL
  resolver so `logout`, metadata cleanup, `doctor`, `--help`, and `--version`
  can still operate when a network URL is malformed. Network operations must
  use validated resolvers.
- Validate discovered OAuth registration/token endpoints with the same scheme
  policy before sending client credentials, authorization codes, or refresh
  tokens. Perform this validation at call time in `auth-service.ts`, immediately
  before the relevant fetch, not during generic dependency construction. This
  closes the actual credential-attachment boundary without breaking local-only
  paths.
- Correct `docs/implementation/config.md`: three URLs, current source path,
  all three local-development overrides, HTTPS policy, and the local-only
  diagnostic/cleanup behavior.

Tests:

- Each variable rejects non-loopback HTTP and names itself in the error.
- HTTPS and each permitted loopback form are accepted.
- Malformed/blank values fail explicitly.
- `GITHITS_CODE_NAV_URL` precedence over `PKGSEER_URL` remains unchanged.
- Help/version/doctor/logout tests prove malformed endpoint variables do not
  block local-only behavior.
- Network command/container tests prove malformed endpoints fail before a
  bearer token or OAuth credential is attached.
- OAuth metadata tests reject insecure discovered endpoints.

### 4. Cover and sanitize OAuth registration/exchange (P1.3)

Files centered on:

- `src/services/auth-service.ts`
- `src/services/auth-service.test.ts`

Implementation:

- Add direct mocked-fetch tests for `registerClient` and
  `exchangeCodeForTokens`.
- Validate successful response shapes rather than truthy-casting unknown
  values. Require non-empty string credentials/tokens and a valid positive
  numeric expiry, retaining the documented default only when expiry is absent.
- Sanitize non-2xx registration and exchange messages with the safe JSON-detail
  parser. Do not embed raw response bodies.
- Preserve `TokenRefreshError`'s structured OAuth classification data for
  terminal refresh decisions, but keep its display message free of raw bodies.
- Keep registration, exchange, and refresh domain behavior separate; do not
  build a generic OAuth framework.

Tests:

- Registration success pins URL, method, headers, redirect URI, grant types,
  response types, and auth method.
- Registration failures cover non-2xx HTML/JSON and malformed success JSON.
- Exchange success pins endpoint, form content type, grant type, PKCE verifier,
  client credentials, code, and redirect URI.
- Exchange failures cover non-2xx HTML/JSON and malformed success JSON.
- No thrown display message contains an HTML/plain-text response body.

### 5. Close login and global CLI error escapes (P0.1)

Files centered on:

- `src/commands/login.ts`
- `src/commands/login.test.ts`
- `src/cli/errors.ts`
- `src/cli/errors.test.ts`
- `src/cli.ts`

Implementation:

- Add phase-specific catches in `loginFlow` for discovery, both registration
  branches, and final auth-session persistence.
- Return the existing failed result shape with separate timeout,
  cannot-connect, protocol, and storage/keychain messages. Do not wrap the
  entire flow in one generic catch or bypass existing callback/client cleanup.
- Ensure other login storage setup failures either return the same storage
  failure shape or reach the safe global boundary; none may produce a stack by
  default.
- Change `handleCliError` so every unknown thrown value is terminal: print a
  normalized single-line message, print the doctor/issue-report hint, and exit
  1. Never rethrow.
- Use a generic message for non-`Error` throws rather than serializing arbitrary
  values.
- Include the original stack only when `GITHITS_DEBUG=cli` or
  `GITHITS_DEBUG=*` is enabled.
- Wrap the existing top-level asynchronous CLI block in a named `main()` with a
  single catch that delegates to `handleCliError`. Include update enforcement,
  lazy command-group registration, and Commander parsing so pre-parse and
  action rejections use the same boundary exactly once.

Tests:

- `handleCliError` covers plain `Error`, `TypeError`, multiline messages, and a
  non-`Error` throw: exit 1, one-line normal output, hint present, no stack.
- Debug scope includes the stack and environment mutation is restored per test.
- Login discovery covers `TypeError`, `FetchTimeoutError`, and `AbortError`.
- Both DCR branches return failed results when registration rejects.
- A stateful storage mock distinguishes preflight persistence from final
  `saveAuthSession` failure.
- Startup-boundary tests cover one pre-parse rejection and one Commander action
  rejection, each rendered once.
- Representative built-process tests assert nonzero exit, one diagnostic, and
  no stack for an unexpected startup failure and an unexpected action failure.
  Together with the single structural async boundary, these guard the report's
  no-unhandled-rejection acceptance criterion.

### PR 1 verification

- `bun test` for all changed unit/parity suites.
- Full `bun test`.
- `bun run typecheck`.
- `bun run lint` and `bun run format:check`.
- `bun run build` and the MCP package build.
- `bun run smoke:cli`.
- `bun run smoke:mcp` because REST behavior is exposed through the public MCP
  client/tool path.
- `bun run smoke:proxy-node` to exercise the changed OAuth/REST fetch paths
  through Node's proxy-aware undici transport.

Release note: PR 1 changes config and REST behavior exported through
`@githits/mcp/client`. Treat it as MCP-package-visible and apply the appropriate
MCP patch bump when preparing the release.

## PR 2: Credential Persistence Safety

### 1. Preserve refresh credentials after transient failure (P0.2)

Files centered on:

- `src/services/token-manager.ts`
- `src/services/token-manager.test.ts`
- `src/services/token-manager.integration.test.ts`
- `docs/implementation/auth.md`

Implementation:

- Keep both existing external-writer reload checks.
- On a non-terminal refresh failure with an expired token, return no access
  token for the current call without clearing storage.
- Leave the expired cached candidate in a state that causes the next
  `getToken()` to enter refresh again; do not serve it as valid and do not add a
  timer, retry loop, or backoff workaround.
- Continue clearing with compare-and-swap only when
  `classifyTerminalRefreshError` returns `invalid_grant` or `invalid_client`.
- Preserve diagnostics breadcrumbs and invalid-client cleanup for terminal
  failures.

Tests:

- Replace existing generic-error tests that currently assert expired-token
  clearing.
- Stateful unit test: first refresh fails with a network error, stored refresh
  token remains, second `getToken()` retries, succeeds, and persists rotation.
- Timeout and 5xx-equivalent transient failures also retain credentials.
- Existing `invalid_grant` and `invalid_client` tests continue to assert token
  clearing; add an expired-token terminal case if needed.
- Real-file integration test proves the original refresh token remains after a
  transient failure and is usable by the next invocation.
- All existing conflict, coalescing, external-writer, and inactive-storage tests
  pass unchanged except tests that intentionally pinned the defect.

### 2. Enforce auth-file permission caps (P1.4a)

Files centered on:

- `src/services/filesystem-service.ts`
- new `src/services/filesystem-service.test.ts`
- auth file/metadata/diagnostic storage callers and their tests

Implementation:

- Extend `atomicWriteFile` with an optional maximum mode rather than changing
  every config-file write.
- Update the `FileSystemService` interface signature and the
  `createMockFileSystemService` factory in `src/services/test-helpers.ts`.
- For an existing sensitive file, use `existingMode & 0o600`; for a new
  sensitive file, use `0o600`.
- Pass the sensitive-mode option from auth token/client storage, auth session
  metadata, and auth diagnostics storage. Leave general init/config and update
  cache writes on existing preservation semantics.
- Do not claim power-loss durability; rename remains atomic at filesystem rename
  granularity.

Tests:

- POSIX real-filesystem test: existing `0644` auth file becomes `0600` after
  save.
- Existing more-restrictive mode is not broadened.
- New sensitive files are `0600`.
- General non-auth atomic writes preserve their current mode behavior.
- Skip only mode-bit assertions on Windows; content/replacement behavior still
  runs there. Use a `process.platform` guard inside the test; the existing CI
  test matrix already runs Linux and Windows.

### 3. Remove ambiguous legacy plaintext copies (P1.4b)

Files centered on:

- `src/services/migrating-auth-storage.ts`
- `src/services/migrating-auth-storage.test.ts`
- `docs/implementation/auth.md`

Implementation:

- Retain the existing deterministic policy: when timestamps tie or are invalid,
  the canonical file candidate wins; without a canonical candidate, return no
  candidate and do not guess between legacy stores.
- Use the existing candidate ambiguity marker to trigger canonical persistence
  before cleanup.
- After the canonical token/client write succeeds, clear the losing legacy
  token/client copies best-effort. If the canonical write fails, clear nothing.
- Cover both token and DCR client records so credentials do not diverge.
- Preserve write-before-clear ordering. Do not attempt to make independent
  stores transactionally atomic in this PR.
- Rewrite the existing misleading ambiguity test to use file mode and exercise
  plaintext candidate selection; supplement it with separate canonical-file
  and legacy-only ambiguity cases.

Tests:

- Equal timestamps with canonical + legacy token: canonical wins, canonical
  save occurs before legacy clear.
- Invalid timestamps exercise the same cleanup behavior.
- Equivalent client-registration cases.
- Canonical save failure leaves legacy data untouched.
- Only ambiguous legacy candidates with no canonical file remain untouched and
  produce the existing warning.

### PR 2 verification

- Targeted token manager, filesystem, auth storage, migration, and integration
  suites.
- Full `bun test` on both Linux and Windows CI paths.
- `bun run typecheck`.
- `bun run lint` and `bun run format:check`.
- `bun run build`.
- `bun run smoke:cli` and `bun run smoke:mcp` because token acquisition and
  auth-required behavior change.

## PR 3: Built-Artifact Product Smoke In CI

### 1. Make smoke launch targets explicit and testable

Files centered on:

- `scripts/cli-smoke.ts`
- `scripts/mcp-smoke.ts`
- `scripts/mcp-call.ts`
- a new small shared smoke launch-target module and unit test

Implementation:

- Represent a CLI launch as an argument vector, never a shell command string.
- Keep local default behavior as `bun run dev`.
- Add an explicit `--cli-entry <absolute-or-relative-path>` option that resolves
  once and launches `node <entry>` for built-artifact mode.
- Thread the same launch target through direct CLI calls, MCP stdio startup, and
  nested CLI/MCP parity calls.
- Validate a missing/invalid entrypoint before starting smoke work.
- Add explicit secret-free modes:
  - CLI unauthenticated mode runs isolated auth assertions plus a structural
    root-help assertion for the expected top-level commands.
  - MCP registration mode calls `runMcpSmoke(..., { includeLiveTools: false })`
    against the stdio server.
- Strip token environment variables and use temporary file auth storage in
  both CI modes. Do not rely on runner cleanliness.
- Preserve existing default behavior for local authenticated smoke runs.

Tests:

- Option parsing and source/built command vectors.
- Paths containing spaces.
- Invalid entrypoint rejection.
- Direct CLI, MCP stdio, and parity subprocesses all receive the selected
  target.
- Unauthenticated mode strips auth variables and isolates config directories.
- Structural CLI assertion fails when an expected top-level command disappears.
- MCP registration assertion already fails when an expected tool disappears;
  preserve that contract.

### 2. Wire the built smoke into CI (P1.2)

File:

- `.github/workflows/ci.yml`

Implementation:

- Run both secret-free smoke modes in the Linux build/check job after root and
  MCP builds and before packaging/upload.
- Launch `dist/cli.js` with the repository's configured Node version while the
  harness itself may continue running under Bun.
- Set `GITHITS_DISABLE_UPDATE_CHECK=1`, file auth storage, and an isolated config
  root.
- Do not add credentials or live-backend calls to PR CI.
- Keep the existing compatibility matrix. Built smoke validates product
  behavior; packed-tarball install behavior remains the compat/package
  validation responsibility.
- Record smoke step timing in CI output and fail if the combined smoke path
  exceeds the review target. Put both smoke commands in a dedicated step with
  `timeout-minutes: 2` and retain the existing per-step timing summary for
  diagnosis.

Acceptance checks:

- Removing a top-level CLI command fails the CLI smoke.
- Removing an MCP tool registration fails the MCP smoke.
- Fresh PR runners pass without secrets and without a reachable backend.
- Both smoke suites execute `dist/cli.js`, not `src/cli.ts` or `bun run dev`.

### PR 3 verification

- New smoke launch-target unit tests.
- `bun run build` and MCP package build.
- Built CLI unauthenticated smoke under Node.
- Built MCP registration smoke under Node.
- Full `bun test`, typecheck, lint, and format checks.
- Inspect a CI run for actual command target, no live calls, and elapsed time.

## Completion

- Update the original review checkboxes and add one-line resolution notes as
  each PR lands.
- Transfer durable behavior into `docs/implementation/config.md`,
  `docs/implementation/auth.md`, `docs/implementation/cli-commands.md`, and the
  smoke/parity documentation.
- Delete this plan after all three PRs land; plans are temporary artifacts.
- Delete the quality review only after its P0-P2 lifecycle rule is satisfied,
  not merely after this P0/P1 scope is complete.
