# Plan: Init stale-token sign-in recovery

## Overall plan

- **Status:** Implemented and validated; code review pending
- **Delivered outcome:** `npx githits@latest init` still reuses or refreshes valid
  stored authentication, but an unclassified/transient refresh failure after
  token expiry can no longer trap the user in a pre-login retry loop. Init
  proceeds to a fresh browser OAuth attempt, and every runnable init
  authentication/recovery command uses the
  `npx githits@latest` form.
- **Assumptions:** Uninstall continues to preserve authentication by design;
  users who want to erase credentials use logout separately. An
  unclassified/transient expired-token refresh failure during interactive setup
  means init has not established usable authentication and may offer a fresh
  OAuth login without first deleting those retained credentials.
- **Unknowns or product decisions:** None. The user explicitly selected the
  `npx githits@latest` command form and requested the smallest change that
  prevents recurrence.
- **Dependencies:** Existing `TokenManager` refresh behavior, `loginFlow()`, init
  dependency injection, Bun tests, CLI smoke suites, and repository plugin/release
  validation.
- **Acceptance criteria:**
  - Successful stored-token refresh still avoids browser login.
  - Missing credentials still enter the normal browser login path.
  - An unclassified/transient network refresh failure after token expiry, or a
    missing/unreadable stored OAuth client registration when expired-token
    refresh is required, reaches browser login during interactive init instead
    of failing before `loginFlow()` and trapping **Retry sign in** on the same
    pre-login failure.
  - The default container and all non-init commands retain their current
    throw/retain/clear semantics for refresh failures.
  - Staged `--install-agents` auth status retains its current default throwing
    probe and `not_checked` fallback semantics.
  - Init recovery, cancellation, skip, and uninstall credential guidance contains
    no bare runnable `githits auth`, `githits login`, or `githits logout` command;
    it uses `npx githits@latest ...` exactly. Existing agent-safe non-interactive
    commands keep `npx -y githits@latest ...`.
  - Uninstall configuration/removal behavior, standalone login, MCP behavior,
    auth storage selection, and public `@githits/mcp` APIs are unchanged; only
    init/uninstall authentication help text adopts the requested npm-executed
    command form.

## Problem and verified current state

User-level `githits uninstall` intentionally removes integrations and guidance
while leaving credentials untouched; `githits logout` owns credential removal.
That separation is documented in `docs/implementation/cli-commands.md` and is
not the defect.

The failure occurs in the init authentication orchestration:

1. `registerInitCommand()` supplies `createContainer()` as `createLoginDeps`.
2. `createContainer()` eagerly calls `TokenManager.getToken()` and defaults to
   throwing refresh failures.
3. A stale stored refresh token receives an HTTP 400 that is not recognized as
   one of the narrowly classified terminal OAuth responses, so the token manager
   preserves the credential and throws.
4. `runInitAuthentication()` catches the exception before it can call
   `loginFlow()`, prints the recovery menu, and starts the loop again when the
   user chooses **Retry sign in**.
5. The next iteration reconstructs the same default container and retries the
   same stored refresh token, producing the observed loop.

Standalone `login` behaves differently: its auth-only dependencies do not
refresh during construction, and `loginFlow()` opens OAuth when the stored token
is expired. This explains why `npx githits@latest login` succeeds after init is
configured without authentication.

The repository already has the required lower-level behavior:
`TokenManager` supports `refreshFailureMode: "return-undefined"`. In that mode,
successful refresh still returns a token, classified terminal failures keep
their existing scoped cleanup, and unclassified/transient failures after token
expiry return no usable token without broadening credential deletion. Init does
not currently select that mode.

Init output is also inconsistent. Most next-step login guidance already prints
`npx githits@latest login`, while the failure recovery block and several nearby
skip/cancel/help strings print bare `githits ...` commands.

## Scope

- Add an interactive-init-only way to ask the existing container/token manager
  to return no usable token for an unclassified/transient network refresh
  failure after token expiry or a missing/unreadable client registration
  encountered while refreshing an expired token instead of throwing.
- Continue into ordinary `loginFlow()` after interactive init establishes that
  no usable token was resolved; its existing expired-token branch opens OAuth.
- Normalize runnable init authentication/recovery commands to the requested
  interactive `npx githits@latest ...` prefix, using init-local constants to
  prevent another inconsistent string.
- Add focused behavioral tests, durable auth/init documentation, and one CLI
  patch changelog fragment.

## Non-goals

- Do not change uninstall to remove credentials.
- Do not broaden terminal HTTP 400 classification or clear every 4xx credential;
  that could destroy recoverable state for responses whose meaning is unknown.
- Do not change global `TokenManager` defaults, standalone `login`, auto-login,
  auth status, authenticated commands, MCP startup, or remote Cursor OAuth.
- Do not add retry counters, new prompts, flags, storage fields, dependencies, a
  new network protocol/endpoint/custom request, or a global command-rendering
  abstraction. The repaired branch intentionally reaches the existing OAuth
  requests already owned by `loginFlow()`.
- Do not normalize unrelated CLI/MCP error messages or documentation outside the
  init surface in this increment.
- Do not bump package versions directly; release preparation consumes the change
  fragment later.

## Target architecture and contracts

`src/container.ts` remains the owner of token-manager construction. Extend its
internal `CreateContainerOptions` with a narrowly named stored-refresh failure
mode that defaults to the existing throwing behavior and is passed directly to
`TokenManager`. Prove this pass-through with one local file-mode container test
that seeds expired tokens without a client registration; this branch requires no
network request and follows existing temporary-directory test conventions.

`InitDependencies.createLoginDeps` accepts that optional mode as a request from
the orchestration caller. Interactive `runInitAuthentication()` requests
`"return-undefined"`; staged `--install-agents` continues to call the factory
without an option and therefore keeps the default throwing/status behavior.
This keeps the policy at the exact call site that needs recovery instead of
changing the shared production factory for every init mode.

Replace the inline production lambda in `registerInitCommand()` with a named,
exported root-internal factory that maps the optional init request to
`CreateContainerOptions`. Give that factory an optional injected container
creator for its direct unit test; production keeps `createContainer` as the
default. The factory test proves its option mapping without module mocking or
adding test-only options to `createContainer`. The one-line
`registerInitCommand()` reference to that named factory remains an explicit
implementation-diff review item; executing it independently would require a
broader command-registration injection or module mock disproportionate to this
change.

Add JSDoc to the named factory explaining that a returned container carries the
selected refresh policy across its constructed services and is intended only as
the dependency bundle for the immediate `loginFlow()` boundary. Future init
steps must not reuse those services for authenticated API work.

`src/commands/init/init.ts` remains the owner of interactive setup orchestration:

```text
interactive init authentication
  -> createContainer(init-only non-throwing refresh mode)
       -> usable existing/refreshed token -> authenticated; no browser
       -> no token, client missing/unreadable during expired refresh,
          or eligible expired refresh failure  -> hasValidToken=false
  -> loginFlow(existing behavior)
       -> fresh OAuth succeeds            -> authenticated
       -> OAuth fails                      -> existing retry/continue/cancel menu
```

The first refresh attempt remains useful and preserves the no-browser happy
path. The mode changes only how interactive init receives an
unclassified/transient network failure after token expiry or a stored client
registration that is missing or unreadable during expired-token refresh: as
absence of a usable token rather than an exception.
Ordinary `loginFlow()` then observes the expired stored token and opens OAuth.
It is not forced: if another process writes a valid session between token
resolution and login, the existing `already_authenticated` result correctly
wins.

Proactive refresh failure is intentionally outside the defect. `TokenManager`
already returns the still-valid current access token for that case regardless of
failure mode, so init remains authenticated until that token expires. Supporting
a different proactive-refresh policy would require a larger token-probe contract
and is not needed for the observed loop.

Credential ownership and cleanup remain unchanged. Classified terminal failures
may perform the token manager's existing active-backend-scoped cleanup.
Unclassified 4xx, transport, timeout, and 5xx failures after token expiry remain
stored for later retry, but they do not block init from offering browser login.
A successful OAuth session replaces the stored session through the existing
atomic auth-storage path.

For init command text, keep two distinct local contracts:

- interactive user commands: `npx githits@latest ...`;
- agent-safe non-interactive commands: existing `npx -y githits@latest ...`.

Do not merge these prefixes or add `-y` to interactive OAuth commands.

## Cross-cutting considerations

- **Security:** No token values enter output. Unknown/transient refresh failures
  do not trigger new credential deletion, and OAuth continues to use the existing
  PKCE, dynamic client registration, storage lock, and atomic session save.
- **Compatibility:** The new container option is internal and default-preserving.
  Environment-token auth, successful refresh, no-token login, keychain/file mode,
  staged init, and all non-init callers retain current behavior.
- **Auth metadata:** When the init-only mode returns no token, the existing
  `createContainer()` no-token branch clears non-secret auto-login session
  metadata even though an unclassified/transient failure retains OAuth tokens.
  That metadata already describes an expired session; successful OAuth rewrites
  it through the existing auth-storage path. Document this expected side effect
  without changing credential cleanup.
- **Performance:** Init performs at most the same initial stored-token refresh,
  followed by OAuth only when no usable token results. No loop counter, polling,
  or additional background work is introduced.
- **Migration and rollback:** No data or config migration is required. Reverting
  the init option and interactive policy wiring restores prior behavior; stored
  auth remains compatible in either direction.
- **Operations:** The user-visible fix belongs to the root `githits` CLI only.
  The change fragment records a root patch and `@githits/mcp: none`.
- **Documentation:** Update the auth implementation note to describe init's
  non-throwing refresh-to-OAuth fallback and the retained-credential behavior.
  Update init command documentation only where needed to state the displayed
  `npx githits@latest` recovery contract.

## Phase map

| Phase | Status | Outcome |
|---|---|---|
| 1. Init recovery fix | Complete; review pending | One implementation increment prevents the refresh loop, normalizes init recovery commands, proves compatibility, and records the CLI patch. |

## Phase 1: Init recovery fix

- **Status:** Complete; validation passed; code review pending
- **Delivered outcome:** Reinstalling with expired stale retained credentials
  either refreshes successfully or opens a fresh OAuth login. Retrying a failed
  OAuth attempt may recheck refresh first, but it reaches OAuth rather than being
  trapped before login.
- **Verified implementation:** The existing non-throwing token-manager mode is
  selected only for interactive init's eligible expired-token probe, including
  a client missing/unreadable when that refresh is required. Ordinary
  `loginFlow()` retains its race-safe valid-session check.
- **Unknowns or product decisions:** None.
- **Dependencies:** Existing mocks in `src/services/test-helpers.ts`, init's
  injected `createLoginDeps`, container tests, and current smoke scripts.
- **Changed files:**
  - `src/container.ts`
  - `src/container.test.ts`
  - `src/services/token-manager.test.ts`
  - `src/commands/init/init.ts`
  - `src/commands/init/init.test.ts`
  - `docs/implementation/auth.md`
  - `docs/implementation/cli-commands.md`
  - `changes/init-refresh-login-recovery.fixed.md`

### Implementation record

1. Added regression coverage before production edits:
   - in `src/services/token-manager.test.ts`, exercise `getToken()` directly with
     `refreshFailureMode: "return-undefined"`: an expired token plus an
     unclassified/transient refresh failure returns `undefined` without clearing
     tokens; a successful expired-token refresh returns the new token; a
     proactive failure returns the still-valid current token; and a missing
     client registration that is missing or unreadable during expired-token refresh returns
     `undefined`. Retain a
     default-mode assertion that the same unclassified expired-token failure
     throws;
   - in `src/container.test.ts`, use existing file-mode temporary-directory
     conventions to seed expired tokens without a client registration. Assert
     that the init-selected mode returns `hasValidToken=false`, while the default
     mode rejects with the existing client-registration-missing error. Assert no
     network call occurs; do not induce a transport failure at the container
     layer;
   - drive init with `hasValidToken=false` plus a retained expired token and
     assert that the browser OAuth path opens and saves the new auth session;
   - drive one failed OAuth attempt followed by **Retry sign in** and a successful
     attempt, asserting that a fresh browser flow is reached on retry and setup
     completes even if the retained expired token is rechecked first;
   - assert that interactive init calls `createLoginDeps` with the non-throwing
     refresh mode, while staged `--install-agents` calls it with no override and
     preserves `not_checked` when the default probe throws;
   - directly test the named production init login-dependency factory with an
     injected container creator and assert that it forwards the selected mode to
     `createContainer`. During implementation review, also verify the one-line
     command registration references this tested factory; record that final
     reference as the intentionally diff-reviewed seam rather than overstating
     automated coverage;
   - cover `--yes` for the eligible expired-token failure: browser OAuth is
     attempted without a prompt, and a failed OAuth attempt continues without
     authentication through the existing `failed_continue` path;
   - assert the init recovery/skip/cancel/uninstall guidance uses
     `npx githits@latest auth status`, `npx githits@latest login`,
     `npx githits@latest login --force`, and
     `npx githits@latest logout` as applicable, with no bare runnable equivalents.
2. Extended `CreateContainerOptions` with an explicit refresh-failure mode and
   passed it into the constructed `TokenManager`. Preserved `"throw"` as the effective
   default so no existing caller changes behavior.
3. Allowed `createLoginDeps` to accept the optional refresh-failure mode. Replaced
   the inline registration lambda with the named, injectable root-internal
   factory that maps this request to `CreateContainerOptions`. Request
   `"return-undefined"` only from interactive `runInitAuthentication()`; leave
   staged callers argument-free. Do not set `resolveStoredToken: false`;
   interactive init must retain the successful silent-refresh path. Add JSDoc
   limiting the returned policy-bearing container to the immediate login flow.
4. Kept the ordinary `loginFlow()` call and its existing browser/port options.
   Did not force login or change the retry/continue/cancel menu. Preserved the
   existing `--yes` policy of attempting login without prompts and continuing
   without authentication if that attempt fails; the repaired expired-token path
   now reaches OAuth before that fallback.
5. Added init-local interactive command constants based on
   `npx githits@latest`; used them for all directly runnable init auth recovery,
   skip, cancellation, next-step, and uninstall credential commands. Kept the
   existing `AGENT_SAFE_CLI` constant and its `-y` behavior unchanged.
6. Updated `docs/implementation/auth.md` with the fallback and metadata behavior.
   Updated `docs/implementation/cli-commands.md` so its uninstall credential
   guidance uses `npx githits@latest logout`, matching the CLI help text while
   preserving uninstall semantics. Added the independent fixed fragment:

   ```yaml
   "githits": patch
   "@githits/mcp": none
   ```

7. Ran focused tests first, inspected the diff for scope containment, then ran
   the repository-required validation below.

### Edge cases and failure behavior

- No stored tokens: ordinary login behaves like current first login.
- Valid token below the refresh threshold: init reports already signed in.
- Successful proactive or expired-token refresh: init reports already signed in
  and does not open a browser.
- Classified invalid refresh/client response: existing scoped cleanup leaves no
  usable tokens, then `loginFlow()` starts OAuth and its existing no-token path
  clears any remaining active client before dynamic client registration.
- Unclassified HTTP 400 for an expired token: credentials are retained, but
  ordinary OAuth starts rather than trapping the recovery menu before login.
- Transport/timeout/5xx expired-token refresh error: credentials are retained;
  OAuth is offered. If OAuth discovery also fails, the existing recovery menu
  remains available and retry makes another complete sign-in attempt.
- Missing or unreadable stored OAuth client registration with an expired token:
  the non-throwing probe returns no usable token, then ordinary `loginFlow()`
  starts OAuth and registers a client as needed.
- Proactive refresh failure with a locally unexpired access token: existing token
  manager behavior returns that token, init remains authenticated, and no OAuth
  fallback is introduced by this increment.
- Concurrent successful login/refresh after init's probe: ordinary `loginFlow()`
  can observe the newer valid token and return `already_authenticated` without
  needless reauthentication.
- Environment API token: remains authenticated and skips OAuth.
- Keychain/config failure before a token probe: still surfaces its specific error;
  the change must not reinterpret storage access or configuration policy failures
  as a network refresh miss. Missing companion client registration during an
  expired-token refresh is the intentional exception handled as a fresh-login
  requirement.
- Interactive `--yes`: no prompt is added. For an eligible expired-token refresh
  failure, init now reaches browser OAuth; if OAuth fails, it follows the existing
  automatic `failed_continue` path. Non-TTY init remains rejected before auth.
- `--skip-login` and staged detect mode continue to avoid authentication
  dependency creation. Eligible staged install retains its existing default
  authentication probe and `not_checked` behavior on a thrown refresh error.

### Validation evidence

Interface-level auth/storage/browser mocks cover the behavior without production
network access. The completed validation is:

- `bun test src/services/token-manager.test.ts src/container.test.ts src/commands/init/init.test.ts`:
  276 passed, 0 failed.
- `bun test`: 3,330 passed, 0 failed across 183 files.
- `bun run typecheck`: passed.
- `bun run lint`: passed across 435 files.
- Changed-file `biome format` and `biome lint`: passed for all five changed
  TypeScript files. Repository-wide `bun run format:check` remains blocked by the
  pre-existing Windows CRLF checkout baseline (435 diagnostics across untouched
  and generated files); no broad line-ending rewrite was made.
- `bun run build`: passed and produced the root CLI bundles and declarations.
- `bun run plugins:generate`: generated the 10 canonical assets;
  `git diff --exit-code` confirmed no semantic generated-asset change.
- `bun run plugins:check`: validated all 10 generated assets.
- `bun run smoke:cli` and `bun run smoke:mcp`: the stock Windows harness first
  exposed its pre-existing `XDG_CONFIG_HOME`/`APPDATA` mismatch. With a temporary
  smoke-only alignment of those roots, both exact commands exited 0; the helper
  adjustment was then removed and has no semantic diff in this increment.

Built smoke variants were not required because smoke launch behavior and CI
product validation did not change. `agent:e2e` was not required because no MCP
instructions, tool descriptions, schemas, public skills, or agent guidance
changed; the affected interactive init surface is covered by CLI unit/smoke
tests. The public onboarding skill was reviewed and already uses the
`npx -y githits@latest` contract, so it remains unchanged until the normal
release lifecycle.

### Phase acceptance criteria

- [x] The exact expired stale-refresh regression opens OAuth and completes without
  requiring the user to configure first and run standalone login.
- [x] Missing/unreadable client registration encountered during expired-token
  refresh reaches fresh login rather than a pre-login retry loop, while actual
  keychain/config access failures still surface.
- [x] Choosing retry after an OAuth failure reaches another OAuth attempt, not only
  another failing token refresh.
- [x] Existing valid-token and successful-refresh tests continue to prove no-browser
  behavior.
- [x] Unclassified/transient expired-token refresh failures still throw at the
  default non-init and staged-init container boundary, staged status remains
  `not_checked`, and those credentials are not newly cleared.
- [x] Init's eligible no-token result clears only the existing non-secret auto-login
  metadata; retained OAuth tokens are unchanged until successful login replaces
  the session.
- [x] All directly runnable init auth commands use the requested npm-executed form.
- [x] Focused and full tests, typecheck, changed-file formatting, lint, build,
  plugin checks, and Windows-aligned CLI/MCP smoke suites pass; plugin generation
  has no semantic diff. The repository-wide format caveat is recorded above.
- [x] The change fragment declares only a root CLI patch.

## Phase-boundary reorientation

This is intentionally one implementation phase. After the increment merges, run
`$next-steps` against current `origin/main` before adding any follow-up work.
Record the observed outcome here only if a verified residual issue remains; do
not expand this plan into global command-guidance cleanup or OAuth error
reclassification without new evidence and a separate product decision.

## Completion and cleanup

The effort is complete when Phase 1 is merged, the durable refresh-fallback
contract is present in implementation documentation, the changelog fragment is
available for release preparation, and no acceptance criterion remains open.
Delete this plan after implementation review confirms that all durable knowledge
has moved to `docs/implementation/` and no follow-up phase is retained.
