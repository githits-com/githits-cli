# Configuration & Environments

## Purpose

The CLI uses four separate service URLs and supports three authentication modes. Getting these wrong causes subtle failures — wrong URL means auth works but API calls fail, wrong auth mode means some tools work but others silently return errors. This document explains the configuration model so changes are made with full context.

## Background

GitHits separates its MCP server (which handles OAuth discovery and the MCP protocol), REST API (which handles search, languages, and feedback), account settings API, and package/source service. In production, they use independent endpoints.

## URL Configuration

| URL | Default | Env var | Used for |
|---|---|---|---|
| **MCP URL** | `https://mcp.githits.com` | `GITHITS_MCP_URL` | OAuth discovery (`.well-known`), DCR registration, auth flow |
| **API URL** | `https://api.githits.com` | `GITHITS_API_URL` | REST endpoints (`/search`, `/languages`, `/feedbacks`) |
| **Accounts URL** | `https://accounts.githits.com` | `GITHITS_ACCOUNTS_URL` | Self-scoped settings and Terms of Service acceptance |
| **Package/source URL** | GitHits-managed package/source service | `GITHITS_CODE_NAV_URL` | Package/source service endpoint used by indexed `search` / `pkg` / `docs` / `code` tooling |

> **These are different services.** Override every URL that differs from production when pointing to a non-production backend.

Environment overrides must use HTTPS. Plain HTTP is accepted only for exact loopback hosts (`localhost`, `127.0.0.1`, and `[::1]`) so local backend development continues to work without permitting bearer tokens or OAuth credentials over remote cleartext connections. The same rule applies to the legacy `PKGSEER_URL` fallback and to OAuth registration/token endpoints returned by discovery.

Network URL validation is deferred until a network-capable path resolves or uses the endpoint. Local-only recovery paths such as help, version output, `doctor`, auth metadata cleanup, and `logout` remain available when an endpoint override is malformed. This is deliberate: a bad network setting must not prevent diagnostics or credential removal.

The MCP URL is also used as the storage key for tokens and client registrations (trailing slashes are stripped for consistent key matching). This means tokens from one environment don't leak into another.

## Authentication Modes

The container (`src/container.ts`) resolves authentication in priority order:

1. **`GITHITS_API_TOKEN`** — If set, uses this token directly. No OAuth flow needed. Quick to set up for CI and automation environments.

2. **Stored OAuth JWT** — Loaded from the configured auth store. If expired, the container automatically attempts a refresh using the stored refresh token. Transient failures retain credentials for a later retry; classified terminal failures clear the active credential state.

3. **Unauthenticated** — No token available. Auth-required CLI commands fail on use, and the MCP server can start but every authenticated tool call will fail. Commands like `auth status` and `doctor` still work to help the user diagnose the issue.

### Auth Mode Capabilities

| Endpoint | OAuth JWT | API Token (`ghi-*`) | Unauthenticated |
|---|---|---|---|
| `/search` | Full access | Full access | Blocked |
| `/languages` | Full access | Full access | Blocked |
| `/feedbacks` | Full access | Full access | Blocked |
| `/functions/v1/settings/me` | Full access | Full access | Blocked |

Package/source access uses the package/source service URL from `GITHITS_CODE_NAV_URL`, defaulting to the GitHits-managed endpoint. MCP registration for `search`, `search_status`, `docs_*`, `pkg_*`, `code_files`, `code_read`, and `code_grep` is always on; CLI registration for top-level `search` / `search-status` plus the `githits code`, `githits pkg`, and `githits docs` groups is also always on.

## Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| `GITHITS_MCP_URL` | Override MCP server URL | `http://localhost:7071/mcp` |
| `GITHITS_API_URL` | Override REST API URL | `http://localhost:8000` |
| `GITHITS_CODE_NAV_URL` | Override package/source service URL | `http://localhost:4000` |
| `GITHITS_ACCOUNTS_URL` | Override account settings origin | `https://accounts.example.test` |
| `GITHITS_API_TOKEN` | API token for authentication | `ghi-abc123...` |
| `GITHITS_AUTH_STORAGE` | Override OAuth credential storage for the current process (`keychain` or `file`) | `file` |
| `GITHITS_TELEMETRY` | Emit end-of-run timing spans to stderr for local profiling | `1` |
| `GITHITS_DISABLE_UPDATE_CHECK` | Disable npm latest-version update notices | `1` |

## Local Storage

GitHits config uses the platform config directory:

```toml
# ~/.config/githits/config.toml on macOS/Linux
[auth]
storage = "keychain"
```

| `auth.storage` | Meaning |
|---|---|
| `keychain` | Default. Store OAuth tokens and DCR client secrets in the system keychain only. |
| `file` | Store OAuth tokens and DCR client secrets as plaintext JSON under the platform config auth path. |

Invalid `GITHITS_AUTH_STORAGE` or `auth.storage` values fail fast with a message that includes the expected values. Runtime keychain-unavailable errors include the exact config file path and the `[auth] storage = "file"` snippet, plus a plaintext-storage warning.

Auto-login startup checks use non-secret metadata before touching the credential store. This avoids keychain reads during ordinary command startup when the local metadata was updated recently and says an unexpired session exists. Missing, stale, expired, or malformed metadata falls back to the credential store so existing users recover after the next successful keychain/file read.

When file mode is enabled, storage uses restrictive POSIX file modes but is not encrypted:

```text
~/.config/githits/          (0700 on Unix-like platforms)
  config.toml              (0600 when written by GitHits)
  auth/                    (0700)
    auth.json              (0600) — OAuth tokens keyed by MCP URL
    client.json            (0600) — DCR client registrations keyed by MCP URL
    metadata.json          (0600) — non-secret session expiry metadata keyed by MCP URL
    diagnostics.json       (0600) — non-secret last-clear breadcrumb keyed by MCP URL
```

The four files under `auth/` are capped at the listed mode for new files and successful rewrites on POSIX; existing more-restrictive files are not broadened. A new `config.toml` uses 0600, while later config rewrites preserve its existing mode. Directory modes apply when GitHits creates the directory and do not repair a pre-existing permissive directory. Windows mode bits are not an ACL guarantee.

Platform roots:

| Platform | Config root |
|---|---|
| Linux/Unix | `$XDG_CONFIG_HOME/githits`, or `~/.config/githits` |
| macOS | `$XDG_CONFIG_HOME/githits`, or `~/.config/githits` |
| Windows | `%APPDATA%\githits`, or `~/AppData/Roaming/githits` |

Legacy `~/.githits/auth.json`, `~/.githits/client.json`, and the old macOS `~/Library/Application Support/githits` auth/config paths are still read for migration and cleared by logout where applicable, but new plaintext writes use the canonical config auth path.

When writing config or auth files, use `FileSystemService` rather than `node:fs` directly — this enables testing via mock implementations from `src/services/test-helpers.ts`. Auth-associated rewrites must pass a 0600 maximum to `atomicWriteFile()` to avoid preserving permissive modes and to prevent readers from observing truncated JSON.

Non-secret update-check state uses the XDG config location:

```
~/.config/githits/update-check.json
```

If `XDG_CONFIG_HOME` is set, the update-check cache lives under
`$XDG_CONFIG_HOME/githits/update-check.json`. See
`docs/implementation/update-check.md` for the update-check cache contract and
eligibility rules.

## How Config Flows Through the System

```
Environment variables + config.toml
  └─ packages/core-internal/src/services/config.ts / src/services/auth-config.ts
       └─ src/container.ts (createContainer)
            ├─ mcpUrl → passed to auth commands, used as storage key
            ├─ apiUrl → passed to GitHitsServiceImpl constructor
            ├─ codeNavigationUrl → passed to CodeNavigationServiceImpl and PackageIntelligenceServiceImpl
            ├─ auth.storage → controls OAuth credential persistence
            ├─ apiToken → resolved from env var or OAuth storage
            └─ hasValidToken → gates authenticated commands
```

Commands receive the full `Dependencies` object. Services receive only what they need (e.g., `GitHitsServiceImpl` gets `apiUrl` and `token`).

## Troubleshooting

- **"Authentication required" despite having a token** — Token may be expired and refresh failed. Run `githits login` to re-authenticate.
- **Custom environment not working** — Set `GITHITS_MCP_URL`, `GITHITS_API_URL`, and `GITHITS_CODE_NAV_URL` for every service that differs from production. They are independent endpoints.
- **Endpoint override rejected** — Use HTTPS for remote services. HTTP is supported only for exact loopback development hosts.
- **Tokens from wrong environment** — Tokens are stored per MCP URL. If you switched `GITHITS_MCP_URL`, you need to re-authenticate for the new URL.
- **System keychain unavailable** — Default keychain mode fails rather than writing plaintext OAuth credentials. Use `GITHITS_API_TOKEN`, fix/unlock the keychain, or set `auth.storage = "file"` / `GITHITS_AUTH_STORAGE=file` if unencrypted file storage is acceptable.
- **Environment-specific failures** — Run `githits doctor --json` in each terminal or agent and compare `runtime`, `environment`, `services`, `config`, and `auth` fields. The report redacts token and secret values.

### Init config parsing behavior

`githits init` and `githits init uninstall` accept both strict JSON and JSONC-style config files when reading agent MCP config files (for example files containing comments or trailing commas).

- Parsing flow first attempts strict JSON, then falls back to JSONC parsing.
- If parsing still fails, setup reports a parse error and leaves the file unchanged.
- Successful setup and uninstall writes are still emitted as canonical JSON with 2-space indentation and a trailing newline.
- Uninstall removes only GitHits/case-variant server entries and leaves other MCP servers, config files, and directories in place.

## Key Reference Files

| File | What it demonstrates |
|---|---|
| `packages/core-internal/src/services/config.ts` | URL and token resolution plus HTTPS/loopback enforcement |
| `src/services/auth-config.ts` | `config.toml` and `GITHITS_AUTH_STORAGE` auth storage mode parsing |
| `src/services/app-config-paths.ts` | Platform config path resolution |
| `src/container.ts` | Auth priority logic and dependency wiring |
| `src/services/auth-storage.ts` | File-based token storage with secure permissions |
| `src/services/filesystem-service.ts` | File system abstraction for testable storage |
| `src/services/update-check-service.ts` | Non-secret update-check cache and npm latest lookup |
| `src/commands/auth-status.ts` | Diagnosing current auth state (reached via `githits auth status`) |
| `src/commands/doctor.ts` | Redacted diagnostics for runtime, environment, config, and auth storage |
| `src/commands/mcp.ts` | MCP tool registration and deferred-auth startup behavior |
