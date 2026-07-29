# Authentication

## Purpose

The CLI supports two authentication methods. Understanding which one is active and how the OAuth flow works is essential for modifying auth-related code without breaking the login experience.

## Background

The GitHits backend exposes OAuth 2.0 endpoints, allowing standard OAuth PKCE flow with Dynamic Client Registration (DCR). The CLI also supports a simpler API token for environments where browser-based OAuth isn't practical (CI, headless servers).

The two methods exist because OAuth provides full access but requires a browser, while API tokens are easy to set up in environments where browser-based OAuth isn't practical.

## Authentication Methods

| Method | Source | Endpoints | Use case |
|---|---|---|---|
| **OAuth JWT** | `githits login` | All (`/search`, `/languages`, `/feedbacks`) | Interactive development |
| **API token** (`ghi-*`) | `GITHITS_API_TOKEN` env var | All (`/search`, `/languages`, `/feedbacks`) | CI, automation, quick setup |

> **The container resolves auth at startup.** The `createContainer()` function checks for `GITHITS_API_TOKEN` first — if set, it takes precedence even when OAuth tokens are stored. If not set, it loads stored OAuth tokens and attempts auto-refresh if expired. See `src/container.ts` for the resolution logic.

## OAuth PKCE Flow

The login command (`src/commands/login.ts`) orchestrates a 9-step OAuth flow (matching the `// Step N:` comments in the code):

1. **Discover endpoints** — Fetch `.well-known/oauth-authorization-server` from the MCP URL. Production OAuth endpoints are served by the GitHits Supabase account host at `https://accounts.githits.com`.
2. **Load or register client via DCR** — Reuse stored client from `client.json`, or register a new one. Re-registers if `--port` changes the redirect URI. New registrations include both the base callback URI and its stable CLI-attributed variant.
3. **Generate PKCE params** — Create `code_verifier`, `code_challenge` (S256), and `state`
4. **Build auth URL** — Construct the authorization URL with PKCE challenge. The exact callback URI carries stable CLI attribution parameters; the same URI is used for the later token exchange.
5. **Start callback server** — Bind local HTTP server to `127.0.0.1:{port}/callback` before opening the browser
6. **Open browser or print URL** — Navigate user to auth URL, or print it if `--no-browser` is set
7. **Verify state** — CSRF protection check on the callback
8. **Exchange code for tokens** — POST to token endpoint with PKCE verifier
9. **Save tokens** — Store to the configured auth store

The flow has a 5-minute timeout. The callback server must start before the browser opens so it's ready to receive the redirect.

OAuth discovery, registration, exchange, and refresh validate endpoint schemes immediately before network use. Remote endpoints must use HTTPS; exact loopback HTTP endpoints remain available for local development. Registration and token responses are runtime-validated, positive numeric-string `expires_in` values are normalized to numbers for OAuth-provider compatibility, and HTTP failures surface only bounded JSON error details rather than raw HTML/plain-text response bodies.

`loginFlow()` converts discovery, registration, and credential-persistence failures into its existing failed-result shape. Network, timeout, protocol, and local storage failures have distinct user-facing messages, so standalone login, init login, and interactive auto-login share the same recovery behavior.

## Token Lifecycle

Tokens are JWTs with a configurable expiration (typically 1 hour). The CLI handles expiration through a `TokenManager` (see `src/services/token-manager.ts`):

- **Proactive refresh** — When 90% of the token lifetime has elapsed (e.g., at ~54 minutes for a 1-hour token), the `TokenManager` refreshes before expiry. This avoids a stale-token window.
- **Reactive refresh** — If the token is already expired, refresh is attempted immediately.
- **401 retry** — The `RefreshingGitHitsService` decorator wraps `GitHitsServiceImpl` and retries once on `AuthenticationError`, calling `forceRefresh()` to handle clock skew or server-side revocation.
- **Refresh token rotation** — Refresh tokens are single-use; after one refresh call spends a token, concurrent refresh calls with the same stored token will fail.
- **Shared retry helper** — GitHits REST calls and package/source service calls both use the same token-refresh/retry flow, so auth drift is handled consistently across both service families.
- **Concurrent coalescing** — Soft refreshes from `getToken()` coalesce with each other, and strict refreshes from `forceRefresh()` coalesce with each other. A strict refresh waits for any in-flight soft refresh to finish, then refreshes the latest stored token instead of reusing a soft result that may not have hit the token endpoint. Once a strict refresh is active, later `getToken()` calls join it instead of serving cached credentials, even if the cached token still looks time-valid. Refresh attempts run inside the auth storage lock, covering storage reload, token endpoint refresh, and token save/clear as one cross-process transaction. The lock is per OS user, not per active config directory, because keychain credentials are shared even when `APPDATA` or `XDG_CONFIG_HOME` differs between agents. This prevents parallel agents from spending the same rotating refresh token at the same time. Storage writes still use compare-and-swap helpers as a defensive guard. Before refreshing a cached token, the manager reloads storage so long-running MCP servers use credentials written by a separate login/refresh.
- **Terminal refresh failures** — Supabase OAuth refresh failures such as `invalid_client`, deleted client registrations, revoked sessions, or refresh-token reuse (`Invalid Refresh Token: Already Used`) are not retried as transient errors. The CLI clears stale token state immediately, and clears the stored client registration for invalid-client failures so the next login performs fresh dynamic client registration.
- **Transient refresh failures** — Transport, timeout, and 5xx failures never clear refresh credentials. If the access token is expired, the current authenticated call surfaces the underlying refresh failure instead of misreporting that no local token exists, while leaving the expired candidate cached and persisted so the next `getToken()` call attempts refresh again. Status/token probes retain their non-throwing expired-auth behavior. A later successful refresh persists token rotation normally; the expired access token is never served.
- **Missing client registration** — Refresh requires the stored dynamic OAuth client registration as well as the refresh token. If tokens exist but that companion keychain entry is missing or unreadable, authenticated calls return an explicit re-login error instead of the generic missing-token message.
- **Active-backend-scoped automatic clears** — Automatic refresh-failure cleanup (`TokenManager`) and login's client re-registration cleanup clear only the **active storage backend class**, never the inactive one. The active class is everything the active-mode load reads: keychain in keychain mode; the file store plus all legacy plaintext stores in file mode (a leftover legacy copy would otherwise be re-migrated on the next load and resurrect the just-cleared credential). This prevents a stale credential in an inactive backend — e.g. a keychain token left over from a launch without `GITHITS_AUTH_STORAGE=file` — from wiping the good credential in the mode the user actually runs. Only explicit `logout` (`clearAuthSession`) clears every backend. The composite methods are `clearActiveTokensIfUnchanged` / `clearActiveClient` on `AuthStorage`; single-backend stores delegate them to the unscoped clear.
- **At login** (`src/commands/login.ts`) — Checks if existing token is still valid before starting the OAuth flow. Respects `--force` flag to re-authenticate regardless.
- **At init** (`src/commands/init/init.ts`) — Resolves auth through `createContainer()` at the login step so standard token refresh runs before falling back to browser login.
- **At auth status** (`src/commands/auth-status.ts`) — Attempts refresh before reporting "Token expired".

For short-lived CLI commands, each invocation gets a fresh `TokenManager`. For the long-running MCP server, the same `TokenManager` + `RefreshingGitHitsService` instance is reused across all tool calls, ensuring tokens stay fresh throughout the session.

To clear tokens manually, use `githits logout`. This removes stored tokens for the current MCP URL without server-side revocation (tokens expire naturally).

## Storage

Credentials are stored in the **system keychain** by default (macOS Keychain, Windows Credential Manager, Linux Secret Service) via `@napi-rs/keyring`. The CLI does not silently downgrade OAuth credentials to plaintext files when the keychain is unavailable.

Machines without a usable keychain can explicitly opt into plaintext OAuth storage with `auth.storage = "file"` in `config.toml` or `GITHITS_AUTH_STORAGE=file`. `GITHITS_API_TOKEN` remains the preferred automation/CI path because it avoids storing OAuth refresh credentials.

### Keychain storage (primary)

Each credential is a separate keychain entry using service name `"githits"`:

| Account key pattern | Content |
|---|---|
| `v1:tokens:<normalizedUrl>` | JSON-serialized `TokenData` (accessToken, refreshToken, expiresAt, createdAt) |
| `v1:client:<normalizedUrl>` | JSON-serialized `ClientRegistration` (clientId, clientSecret, redirectUri, registeredAt) |

The `v1:` prefix allows future key format changes without collisions.

#### Windows chunked storage

Windows Credential Manager limits credential blobs to `CRED_MAX_CREDENTIAL_BLOB_SIZE` (2560 **bytes**). The `@napi-rs/keyring` binding encodes passwords as UTF-16 (2 bytes per character), so the effective character limit is 1280. Since JSON-serialized token data (especially JWT access tokens) can exceed this, the CLI wraps the `KeyringService` with a `ChunkingKeyringService` decorator on Windows (`process.platform === "win32"`). This decorator is not applied on macOS or Linux, which have no practical per-entry size limits.

When a value exceeds `WINDOWS_MAX_ENTRY_SIZE` (1200 characters — a conservative threshold providing 80-char margin from the 1280 limit), the decorator splits it across multiple keyring entries. The chunk size is configurable via the `ChunkingKeyringService` constructor, so the same decorator can be reused if other platforms have different limits:

| Account key pattern | Content |
|---|---|
| `<original-key>` | Sentinel: `CHUNKED:<writeId>:<count>` |
| `<original-key>:chunk:<writeId>:0` | First chunk of the JSON value |
| `<original-key>:chunk:<writeId>:N` | Nth chunk of the JSON value |

Each write uses a unique `writeId` to namespace chunk keys. This ensures atomicity: new chunks are written before the sentinel is updated, so a crash at any point leaves valid data. Old chunks are cleaned up after the sentinel is committed.

Values under 1200 characters are stored directly with no sentinel, maintaining full backward compatibility with pre-chunking CLI versions. If a user downgrades the CLI after tokens were stored as chunks, the old CLI reads the sentinel as raw text, fails JSON parsing (via `parseJsonOrNull`), and prompts re-login. The same applies to chunked client registrations, which would trigger re-registration. Both are acceptable graceful degradation.

The `getStorageLocation()` method returns a platform-specific label: "macOS Keychain (githits)" on macOS, "Windows Credential Manager (githits)" on Windows, and "System keychain (githits)" on Linux.

### File storage (explicit)

When `auth.storage = "file"`, auth data is stored under the platform config auth directory with two files:

| File | Content | Structure |
|---|---|---|
| `auth.json` | OAuth tokens | `{ version: 1, tokens: { [mcpUrl]: { accessToken, refreshToken, expiresAt (string\|null), createdAt } } }` |
| `client.json` | DCR client registration | `{ version: 1, clients: { [mcpUrl]: { clientId, clientSecret, redirectUri, registeredAt } } }` |

On POSIX, new files and successful rewrites are capped at 0600 permissions; an existing more-restrictive mode such as 0400 is preserved. The directory is requested with 0700 when created. Rewrites use `FileSystemService.atomicWriteFile()` so readers do not observe half-written JSON, but no power-loss durability is claimed. POSIX mode bits are not a Windows ACL guarantee. File storage protects against other local users where those modes apply, but does not encrypt credentials at rest.

Typical Linux layout:

```text
~/.config/githits/
  config.toml
  auth/
    auth.json
    client.json
```

The legacy `~/.githits/auth.json` and `~/.githits/client.json` path is still read for migration and cleared by logout, but new file-mode writes go to the platform config auth directory.

### Migration

`MigratingAuthStorage` only performs same-storage-class migration. Switching `auth.storage` between `keychain` and `file` intentionally does not move credentials; run `githits login` after changing modes.

Keychain mode:

1. Check keychain — if found, return it
2. Do not inspect plaintext file storage or legacy plaintext paths
3. Keychain empty or unavailable — return null

File mode:

1. Read canonical and legacy plaintext candidates without inspecting keychain credentials.
2. Select the unique newest valid timestamp when one exists.
3. For tied or invalid timestamps, prefer the canonical candidate when present, re-persist it, then clear all legacy copies best-effort.
4. If ambiguity exists only between legacy stores, return no candidate, leave every legacy entry intact, and warn instead of guessing.

The canonical target write must succeed before any legacy source entry is deleted. Tokens and client registrations migrate independently, and cleanup across independent stores is not transactionally atomic.

### Architecture

```
Container (createAuthStorage)
  └─ LockedAuthStorage (cross-process auth mutation/refresh lock)
       └─ MigratingAuthStorage (decorator)
            ├─ KeychainAuthStorage
            │    └─ ChunkingKeyringService (Windows only, decorator)
            │         └─ KeyringServiceImpl ← @napi-rs/keyring
            ├─ ModeAwareFileAuthStorage
            │    └─ AuthStorageImpl ← platform config auth path
            └─ AuthStorageImpl ← legacy ~/.githits path
```

All credential types are keyed by normalized MCP base URL (trailing slashes stripped), supporting multiple environments simultaneously.

`LockedAuthStorage` serializes mutations and file-mode migration loads across CLI processes and long-running MCP servers with an `auth.lock` directory under the platform config path. File-mode loads participate because migration can reconcile ambiguous plaintext candidates by writing the canonical record and clearing legacy copies; ordinary keychain loads remain read-only and avoid this lock. The lock records PID and process start time so dead-owner locks can be reclaimed without stealing live locks. Token refresh holds this lock while it reloads stored credentials, calls the token endpoint, and saves or clears the result.

## How Auth Flows Through the System

```
CLI startup / MCP server start
  └─ createContainer()
       ├─ GITHITS_API_TOKEN set? → use GitHitsServiceImpl directly (no refresh needed)
       └─ no env token → create TokenManager + RefreshingGitHitsService
            └─ TokenManager.getToken() for initial check
                 ├─ stored token valid? → use it
                 ├─ stored token near-expiry (≥90% lifetime)? → proactive refresh
                 ├─ stored token expired? → reactive refresh
                  │    ├─ refresh success → save new tokens, use them
                  │    ├─ transient failure → reload storage; retain unchanged refresh credentials and return no expired access token
                  │    └─ terminal failure → reload storage; clear the active backend only if unchanged
                  └─ no stored token → hasValidToken=false

Per API call (via RefreshingGitHitsService):
  └─ TokenProvider.getToken() → get fresh token
       └─ on AuthenticationError from API → forceRefresh() → retry once
```

The MCP server starts without a synchronous auth gate. Tool calls resolve tokens through the shared token provider and return per-tool auth errors when no valid token is available.

## Troubleshooting

- **"Authentication required" from a command or MCP tool** — No valid token found. Run `githits login` or set `GITHITS_API_TOKEN`.
- **Different auth behavior across terminals or agents** — Run `githits doctor` or `githits doctor --json` to compare redacted runtime, environment, config, and auth-storage diagnostics without exposing token values.
- **"Already logged in."** — Token is still valid. Use `githits login --force` to re-authenticate.
- **Port conflicts on login** — The callback server uses the port from the stored client registration. On first login, a random port (8000–9999) is chosen and saved. Use `--port <port>` to change it (triggers re-registration).
- **Token refresh fails silently** — The token manager first reloads storage in case another process refreshed credentials. Transient failures retain unchanged refresh credentials and later calls retry. Only classified terminal failures clear the stale token from the active backend and require login again.
- **Logged out after running in a different storage mode** — Credentials saved under one `auth.storage` mode are invisible to the other (keychain and file modes do not cross-inspect). An inconsistent `GITHITS_AUTH_STORAGE` across contexts (e.g. set for the MCP server but not the interactive shell) looks like a logout. Automatic clears no longer compound this by wiping the other mode's credentials, but the fix for the phantom logout is to make the mode consistent everywhere (prefer `auth.storage` in `config.toml` over the env var) and `githits login --force` once.
- **Clearing auth** — Run `githits logout` to remove stored tokens and client registration for the current environment.
- **System keychain unavailable** — In default keychain mode, OAuth login/refresh fails rather than writing plaintext credentials. Use `GITHITS_API_TOKEN`, fix/unlock the keychain, or explicitly configure `auth.storage = "file"` if plaintext local storage is acceptable.
- **Windows "password encoded as UTF-16 is longer than platform limit"** — The Windows Credential Manager limits credential blobs to 2560 bytes (`CRED_MAX_CREDENTIAL_BLOB_SIZE`). Since passwords are stored as UTF-16 (2 bytes per char), the effective limit is 1280 characters. The `ChunkingKeyringService` decorator handles this automatically by splitting large values across multiple entries. If this error occurs on an older CLI version, upgrade to get chunked storage support.

## Diagnostics

- **Telemetry (opt-in, local repro only)** — When `GITHITS_TELEMETRY` is enabled, auth spans carry diagnostic attributes: `auth.fingerprint` records the resolved storage `mode`, platform, and which scope-determining env vars are set (booleans only, never values); token/client clear spans carry a `reason` (`terminal_invalid_refresh_token`, `terminal_invalid_client`, `logout`). This flushes to stderr and is invisible to external users running the MCP server, so it only helps when we reproduce locally with the flag on.
- **Persisted auth-clear breadcrumb (doctor-visible)** — Because the only diagnostic channel that reaches an external user is persisted state surfaced by `githits doctor`, the last auth-clear `{ reason, at }` is persisted to `auth/diagnostics.json` and rendered by `doctor` as `last clear: ...`. When the active token is missing, `doctor` adds a recommendation explaining the cause (refresh-token reuse/expiry, rejected client registration, or explicit logout). Writes happen at the clear sites — `logout` and `TokenManager` terminal refresh failures — and are best-effort, so a diagnostics write can never break the path it observes. The file lives separately from `metadata.json` because credential clears wipe metadata and a breadcrumb stored there would erase itself; it is only ever overwritten by the next event, never cleared, and holds no secrets (a reason enum and timestamp keyed by MCP URL). Like other auth-associated files, successful POSIX rewrites are capped at 0600.

## Key Reference Files

| File | What it demonstrates |
|---|---|
| `src/commands/login.ts` | Full OAuth PKCE flow orchestration |
| `src/commands/logout.ts` | Token and client removal and storage cleanup |
| `src/container.ts` | Dependency wiring and auth-command container without eager token refresh |
| `src/services/token-manager.ts` | `TokenProvider` interface, `TokenManager` (proactive refresh, coalescing) |
| `src/services/refreshing-githits-service.ts` | `GitHitsService` decorator with token refresh and 401 retry |
| `src/services/execute-with-token-refresh.ts` | Shared helper for token-authenticated retry-on-refresh flows |
| `src/services/code-navigation-service.ts` | Package/source service client using the shared refresh helper |
| `src/services/auth-service.ts` | OAuth operations (DCR, PKCE, token exchange, callback server) |
| `src/services/auth-storage.ts` | `AuthStorage` interface and file-based implementation |
| `src/services/auth-diagnostics-storage.ts` | Persisted, retained-across-clears breadcrumb of why auth was last cleared |
| `src/services/locked-auth-storage.ts` | Cross-process auth-storage lock and conditional write serialization |
| `src/services/auth-config.ts` | `config.toml` and `GITHITS_AUTH_STORAGE` parsing |
| `src/services/app-config-paths.ts` | Platform-specific config/auth path resolution |
| `src/commands/doctor.ts` | Redacted runtime/config/auth diagnostics for support and environment comparisons |
| `src/services/mode-aware-file-auth-storage.ts` | File-write guard for `auth.storage` policy |
| `src/services/keyring-service.ts` | `KeyringService` interface wrapping `@napi-rs/keyring` |
| `src/services/chunking-keyring-service.ts` | `KeyringService` decorator for chunked storage (Windows 2560-char limit) |
| `src/services/keychain-auth-storage.ts` | `AuthStorage` implementation backed by system keychain |
| `src/services/migrating-auth-storage.ts` | Active-mode auth storage plus legacy plaintext-to-plaintext migration |
| `src/services/filesystem-service.ts` | File system abstraction for testable storage |
| `src/auth/pkce.ts` | PKCE cryptographic primitives |
| `src/services/config.ts` | URL and API token configuration |
