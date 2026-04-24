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

1. **Discover endpoints** — Fetch `.well-known/oauth-authorization-server` from the MCP URL
2. **Load or register client via DCR** — Reuse stored client from `client.json`, or register a new one. Re-registers if `--port` changes the redirect URI.
3. **Generate PKCE params** — Create `code_verifier`, `code_challenge` (S256), and `state`
4. **Build auth URL** — Construct the authorization URL with PKCE challenge
5. **Start callback server** — Bind local HTTP server to `127.0.0.1:{port}/callback` before opening the browser
6. **Open browser or print URL** — Navigate user to auth URL, or print it if `--no-browser` is set
7. **Verify state** — CSRF protection check on the callback
8. **Exchange code for tokens** — POST to token endpoint with PKCE verifier
9. **Save tokens** — Store to the configured auth store

The flow has a 5-minute timeout. The callback server must start before the browser opens so it's ready to receive the redirect.

### Automatic login bootstrap for interactive CLI commands

Phase 1 of the streamlined signup flow adds a CLI-boundary bootstrap in
`src/cli.ts` for a small allowlist of interactive commands:

- `githits example ...`
- `githits languages ...`
- `githits feedback ...`

When one of those commands runs in an interactive TTY and no valid token is
available, the CLI calls the existing `loginFlow()` from `src/commands/login.ts`
before dispatching the command action. After authentication succeeds, the
original command continues and builds a fresh container with the newly saved
tokens.

The bootstrap deliberately does **not** run for:

- non-interactive/stdio-driven execution
- explicit auth and recovery surfaces such as `login`, `logout`, `auth status`,
  `init`, and `mcp`

For interactive `--json` invocations, the same bootstrap runs, but login
progress is written to stderr so the command's JSON payload can remain the only
stdout output.

This bootstrap does not widen the package/source command surface. The gated
`search`, `code`, and `pkg` commands still rely on startup capability checks
for registration and remain hidden until capability is known to be open, or a
local CLI override forces them on.

## Token Lifecycle

Tokens are JWTs with a configurable expiration (typically 1 hour). The CLI handles expiration through a `TokenManager` (see `src/services/token-manager.ts`):

- **Proactive refresh** — When 90% of the token lifetime has elapsed (e.g., at ~54 minutes for a 1-hour token), the `TokenManager` refreshes before expiry. This avoids a stale-token window.
- **Reactive refresh** — If the token is already expired, refresh is attempted immediately.
- **401 retry** — The `RefreshingGitHitsService` decorator wraps `GitHitsServiceImpl` and retries once on `AuthenticationError`, calling `forceRefresh()` to handle clock skew or server-side revocation.
- **Shared retry helper** — GitHits REST calls and package/source service calls both use the same token-refresh/retry flow, so auth drift is handled consistently across both service families.
- **Concurrent coalescing** — Multiple concurrent refresh requests share a single in-flight Promise. Storage writes use compare-and-swap helpers so a failed refresh cannot overwrite or clear credentials another process already updated.
- **At login** (`src/commands/login.ts`) — Checks if existing token is still valid before starting the OAuth flow. Respects `--force` flag to re-authenticate regardless.
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

Both files use 0600 permissions. The directory uses 0700. Rewrites use `FileSystemService.atomicWriteFile()` so a crash does not leave half-written JSON. This protects against other local users but does not encrypt credentials at rest.

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

On first use after upgrading, `MigratingAuthStorage` transparently migrates credentials according to the configured storage mode:

Keychain mode:

1. Check keychain — if found, return it
2. Check new file path, then legacy `~/.githits` — if found, write to keychain, delete the migrated plaintext entry, return it
3. Both empty — return null

File mode:

1. Check new file path — if found, return it
2. Check legacy `~/.githits` — if found, write to new file path, delete legacy entry, return it
3. Check keychain only as a last-resort migration source, then warn before exporting encrypted credentials to plaintext

The configured target write must succeed before the source entry is deleted. Tokens and client registrations migrate independently. If both plaintext paths contain entries, the newer timestamp wins; ambiguous ties prefer the new file path and leave the other entry intact with a warning.

### Architecture

```
Container (createAuthStorage)
  └─ LockedAuthStorage (cross-process write lock)
       └─ MigratingAuthStorage (decorator)
            ├─ KeychainAuthStorage
            │    └─ ChunkingKeyringService (Windows only, decorator)
            │         └─ KeyringServiceImpl ← @napi-rs/keyring
            ├─ ModeAwareFileAuthStorage
            │    └─ AuthStorageImpl ← platform config auth path
            └─ AuthStorageImpl ← legacy ~/.githits path
```

All credential types are keyed by normalized MCP base URL (trailing slashes stripped), supporting multiple environments simultaneously.

`LockedAuthStorage` serializes mutating auth operations across CLI processes and long-running MCP servers with an `auth.lock` directory under the platform config path. The lock records PID and process start time so dead-owner locks can be reclaimed without stealing live locks.

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
                  │    └─ refresh fail → reload storage; use externally updated tokens or clear only if unchanged and expired
                  └─ no stored token → hasValidToken=false

Per API call (via RefreshingGitHitsService):
  └─ TokenProvider.getToken() → get fresh token
       └─ on AuthenticationError from API → forceRefresh() → retry once
```

The MCP server starts without a synchronous auth gate. Tool calls resolve tokens through the shared token provider and return per-tool auth errors when no valid token is available.

For `example`, `languages`, and `feedback`, there is now one extra step before
the action runs:

```
CLI preAction hook
  └─ eligible interactive command?
       ├─ no → run command normally
       └─ yes → createContainer()
            ├─ valid token available? → run command normally
            └─ no valid token → loginFlow()
                 ├─ success → continue into the original command action
                 └─ failure → print login error and exit 1
```

## Troubleshooting

- **"Authentication required" from a command or MCP tool** — No valid token found. Run `githits login` or set `GITHITS_API_TOKEN`.
- **Browser did not open for a piped or redirected invocation** — Expected. Auto-login bootstrap still requires an interactive TTY. Authenticate first with `githits login` or use `GITHITS_API_TOKEN`.
- **Interactive `--json` printed login progress** — That progress should go to stderr only. If stdout contains login chatter, the login reporter wiring in `src/commands/login.ts` / `src/cli.ts` has regressed.
- **"Already logged in."** — Token is still valid. Use `githits login --force` to re-authenticate.
- **Port conflicts on login** — The callback server uses the port from the stored client registration. On first login, a random port (8000–9999) is chosen and saved. Use `--port <port>` to change it (triggers re-registration).
- **Token refresh fails silently** — By design. The token manager first reloads storage in case another process refreshed credentials. If the expired token is still unchanged, it clears that stale token and later calls prompt re-login.
- **Clearing auth** — Run `githits logout` to remove stored tokens and client registration for the current environment.
- **System keychain unavailable** — In default keychain mode, OAuth login/refresh fails rather than writing plaintext credentials. Use `GITHITS_API_TOKEN`, fix/unlock the keychain, or explicitly configure `auth.storage = "file"` if plaintext local storage is acceptable.
- **Windows "password encoded as UTF-16 is longer than platform limit"** — The Windows Credential Manager limits credential blobs to 2560 bytes (`CRED_MAX_CREDENTIAL_BLOB_SIZE`). Since passwords are stored as UTF-16 (2 bytes per char), the effective limit is 1280 characters. The `ChunkingKeyringService` decorator handles this automatically by splitting large values across multiple entries. If this error occurs on an older CLI version, upgrade to get chunked storage support.

## Key Reference Files

| File | What it demonstrates |
|---|---|
| `src/commands/login.ts` | Full OAuth PKCE flow orchestration |
| `src/cli.ts` | CLI pre-action bootstrap for phase-1 automatic login |
| `src/commands/logout.ts` | Token and client removal and storage cleanup |
| `src/shared/auto-login.ts` | Command allowlist and auto-login decision logic |
| `src/container.ts` | Dependency wiring, keychain probe with fallback, and auth-command container without eager token refresh |
| `src/services/token-manager.ts` | `TokenProvider` interface, `TokenManager` (proactive refresh, coalescing) |
| `src/services/refreshing-githits-service.ts` | `GitHitsService` decorator with token refresh and 401 retry |
| `src/services/execute-with-token-refresh.ts` | Shared helper for token-authenticated retry-on-refresh flows |
| `src/services/code-navigation-service.ts` | Package/source service client using the shared refresh helper |
| `src/services/auth-service.ts` | OAuth operations (DCR, PKCE, token exchange, callback server) |
| `src/services/auth-storage.ts` | `AuthStorage` interface and file-based implementation |
| `src/services/locked-auth-storage.ts` | Cross-process auth-storage lock and conditional write serialization |
| `src/services/auth-config.ts` | `config.toml` and `GITHITS_AUTH_STORAGE` parsing |
| `src/services/app-config-paths.ts` | Platform-specific config/auth path resolution |
| `src/services/mode-aware-file-auth-storage.ts` | File-write guard for `auth.storage` policy |
| `src/services/keyring-service.ts` | `KeyringService` interface wrapping `@napi-rs/keyring` |
| `src/services/chunking-keyring-service.ts` | `KeyringService` decorator for chunked storage (Windows 2560-char limit) |
| `src/services/keychain-auth-storage.ts` | `AuthStorage` implementation backed by system keychain |
| `src/services/migrating-auth-storage.ts` | Mode-aware migration across keychain, config file storage, and legacy file storage |
| `src/services/filesystem-service.ts` | File system abstraction for testable storage |
| `src/auth/pkce.ts` | PKCE cryptographic primitives |
| `src/services/config.ts` | URL and API token configuration |
