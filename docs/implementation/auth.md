# Authentication

## Purpose

The CLI supports two authentication methods with different capabilities. Understanding which one is active and how the OAuth flow works is essential for modifying auth-related code without breaking the login experience.

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
9. **Save tokens** — Store to system keychain (or fallback file storage)

The flow has a 5-minute timeout. The callback server must start before the browser opens so it's ready to receive the redirect.

## Token Lifecycle

Tokens are JWTs with a configurable expiration (typically 1 hour). The CLI handles expiration through a `TokenManager` (see `src/services/token-manager.ts`):

- **Proactive refresh** — When 90% of the token lifetime has elapsed (e.g., at ~54 minutes for a 1-hour token), the `TokenManager` refreshes before expiry. This avoids a stale-token window.
- **Reactive refresh** — If the token is already expired, refresh is attempted immediately.
- **401 retry** — The `RefreshingGitHitsService` decorator wraps `GitHitsServiceImpl` and retries once on `AuthenticationError`, calling `forceRefresh()` to handle clock skew or server-side revocation.
- **Concurrent coalescing** — Multiple concurrent refresh requests share a single in-flight Promise.
- **At login** (`src/commands/login.ts`) — Checks if existing token is still valid before starting the OAuth flow. Respects `--force` flag to re-authenticate regardless.
- **At auth status** (`src/commands/auth-status.ts`) — Attempts refresh before reporting "Token expired".

For short-lived CLI commands, each invocation gets a fresh `TokenManager`. For the long-running MCP server, the same `TokenManager` + `RefreshingGitHitsService` instance is reused across all tool calls, ensuring tokens stay fresh throughout the session.

To clear tokens manually, use `githits logout`. This removes stored tokens for the current MCP URL without server-side revocation (tokens expire naturally).

## Storage

Credentials are stored in the **system keychain** (macOS Keychain, Windows Credential Manager, Linux Secret Service) via `@napi-rs/keyring`. If the keychain is unavailable (headless Linux, CI), the CLI falls back to file-based storage in `~/.githits/` with a stderr warning.

### Keychain storage (primary)

Each credential is a separate keychain entry using service name `"githits"`:

| Account key pattern | Content |
|---|---|
| `v1:tokens:<normalizedUrl>` | JSON-serialized `TokenData` (accessToken, refreshToken, expiresAt, createdAt) |
| `v1:client:<normalizedUrl>` | JSON-serialized `ClientRegistration` (clientId, clientSecret, redirectUri, registeredAt) |

The `v1:` prefix allows future key format changes without collisions.

#### Windows chunked storage

Windows Credential Manager limits password fields to 2560 UTF-16 code units. Since JSON-serialized token data (especially JWT access tokens) can exceed this, the CLI wraps the `KeyringService` with a `ChunkingKeyringService` decorator on Windows (`process.platform === "win32"`). This decorator is not applied on macOS or Linux, which have no practical per-entry size limits.

When a value exceeds `WINDOWS_MAX_ENTRY_SIZE` (2400 characters — a conservative threshold below the 2560 limit), the decorator splits it across multiple keyring entries. The chunk size is configurable via the `ChunkingKeyringService` constructor, so the same decorator can be reused if other platforms have different limits:

| Account key pattern | Content |
|---|---|
| `<original-key>` | Sentinel: `CHUNKED:<writeId>:<count>` |
| `<original-key>:chunk:<writeId>:0` | First chunk of the JSON value |
| `<original-key>:chunk:<writeId>:N` | Nth chunk of the JSON value |

Each write uses a unique `writeId` to namespace chunk keys. This ensures atomicity: new chunks are written before the sentinel is updated, so a crash at any point leaves valid data. Old chunks are cleaned up after the sentinel is committed.

Values under 2400 characters are stored directly with no sentinel, maintaining full backward compatibility with pre-chunking CLI versions. If a user downgrades the CLI after tokens were stored as chunks, the old CLI reads the sentinel as raw text, fails JSON parsing (via `parseJsonOrNull`), and prompts re-login. The same applies to chunked client registrations, which would trigger re-registration. Both are acceptable graceful degradation.

The `getStorageLocation()` method returns a platform-specific label: "macOS Keychain (githits)" on macOS, "Windows Credential Manager (githits)" on Windows, and "System keychain (githits)" on Linux.

### File storage (fallback)

When the keychain is unavailable, auth data is stored in `~/.githits/` with two files:

| File | Content | Structure |
|---|---|---|
| `auth.json` | OAuth tokens | `{ version: 1, tokens: { [mcpUrl]: { accessToken, refreshToken, expiresAt (string\|null), createdAt } } }` |
| `client.json` | DCR client registration | `{ version: 1, clients: { [mcpUrl]: { clientId, clientSecret, redirectUri, registeredAt } } }` |

Both files use 0600 permissions. The directory uses 0700.

### Migration

On first use after upgrading, the `MigratingAuthStorage` decorator transparently migrates credentials from files to the keychain:

1. Check keychain — if found, return it
2. Check file — if found, write to keychain, delete from file, return it
3. Both empty — return null

Keychain write must succeed before the file entry is deleted. Tokens and client registrations migrate independently.

### Architecture

```
Container (createAuthStorage)
  └─ MigratingAuthStorage (decorator)
       ├─ KeychainAuthStorage (primary)
       │    └─ ChunkingKeyringService (Windows only, decorator)
       │         └─ KeyringServiceImpl ← @napi-rs/keyring
       └─ AuthStorageImpl (legacy) ← file-based
```

All credential types are keyed by normalized MCP base URL (trailing slashes stripped), supporting multiple environments simultaneously.

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
                 │    └─ refresh fail → clear stale auth (hasValidToken=false)
                 └─ no stored token → hasValidToken=false

Per API call (via RefreshingGitHitsService):
  └─ TokenProvider.getToken() → get fresh token
       └─ on AuthenticationError from API → forceRefresh() → retry once
```

The `hasValidToken` flag is checked by `requireAuth()` in `src/commands/mcp.ts` before starting the MCP server.

## Troubleshooting

- **"Authentication required" on MCP start** — No valid token found. Run `githits login` or set `GITHITS_API_TOKEN`.
- **"Already logged in."** — Token is still valid. Use `githits login --force` to re-authenticate.
- **Port conflicts on login** — The callback server uses the port from the stored client registration. On first login, a random port (8000–9999) is chosen and saved. Use `--port <port>` to change it (triggers re-registration).
- **Token refresh fails silently** — By design. The container clears stale auth and `hasValidToken` becomes false, prompting re-login.
- **Clearing auth** — Run `githits logout` to remove stored tokens and client registration for the current environment.
- **Keychain unavailable warning** — If the system keychain is not accessible (headless Linux, CI), the CLI falls back to file storage in `~/.githits/` and prints a warning to stderr.
- **Windows "password encoded as UTF-16 is longer than platform limit"** — The Windows Credential Manager limits entries to 2560 UTF-16 chars. The `ChunkingKeyringService` decorator handles this automatically by splitting large values across multiple entries. If this error occurs on an older CLI version, upgrade to get chunked storage support.

## Key Reference Files

| File | What it demonstrates |
|---|---|
| `src/commands/login.ts` | Full OAuth PKCE flow orchestration |
| `src/commands/logout.ts` | Token and client removal and storage cleanup |
| `src/container.ts` | Dependency wiring, keychain probe with fallback |
| `src/services/token-manager.ts` | `TokenProvider` interface, `TokenManager` (proactive refresh, coalescing) |
| `src/services/refreshing-githits-service.ts` | `GitHitsService` decorator with token refresh and 401 retry |
| `src/services/auth-service.ts` | OAuth operations (DCR, PKCE, token exchange, callback server) |
| `src/services/auth-storage.ts` | `AuthStorage` interface and file-based implementation |
| `src/services/keyring-service.ts` | `KeyringService` interface wrapping `@napi-rs/keyring` |
| `src/services/chunking-keyring-service.ts` | `KeyringService` decorator for chunked storage (Windows 2560-char limit) |
| `src/services/keychain-auth-storage.ts` | `AuthStorage` implementation backed by system keychain |
| `src/services/migrating-auth-storage.ts` | Migration decorator (keychain primary + file legacy) |
| `src/services/filesystem-service.ts` | File system abstraction for testable storage |
| `src/auth/pkce.ts` | PKCE cryptographic primitives |
| `src/services/config.ts` | URL and API token configuration |
