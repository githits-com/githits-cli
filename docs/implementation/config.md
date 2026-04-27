# Configuration & Environments

## Purpose

The CLI uses two separate URLs and supports three authentication modes. Getting these wrong causes subtle failures — wrong URL means auth works but API calls fail, wrong auth mode means some tools work but others silently return errors. This document explains the configuration model so changes are made with full context.

## Background

GitHits separates its MCP server (which handles OAuth discovery and the MCP protocol) from its REST API (which handles search, languages, and feedback). In production, they're at different domains.

## URL Configuration

| URL | Default | Env var | Used for |
|---|---|---|---|
| **MCP URL** | `https://mcp.githits.com` | `GITHITS_MCP_URL` | OAuth discovery (`.well-known`), DCR registration, auth flow |
| **API URL** | `https://api.githits.com` | `GITHITS_API_URL` | REST endpoints (`/search`, `/languages`, `/feedbacks`) |
| **Package/source URL** | `https://pkgseer.dev` in the default production environment; otherwise unset | `GITHITS_CODE_NAV_URL` | Package/source service endpoint used by hidden indexed `search` / `pkg` / `code` tooling |

> **These are different services.** Setting only one won't work for custom environments. Both must be overridden together when pointing to a non-production backend.

The MCP URL is also used as the storage key for tokens and client registrations in `~/.githits/` (trailing slashes are stripped for consistent key matching). This means tokens from one environment don't leak into another.

## Authentication Modes

The container (`src/container.ts`) resolves authentication in priority order:

1. **`GITHITS_API_TOKEN`** — If set, uses this token directly. No OAuth flow needed. Quick to set up for CI and automation environments.

2. **Stored OAuth JWT** — Loaded from `~/.githits/auth.json`. If expired, the container automatically attempts a refresh using the stored refresh token. If refresh fails, auth is cleared silently.

3. **Unauthenticated** — No token available. Auth-required CLI commands fail on use, and the MCP server can start but every authenticated tool call will fail. Commands like `auth status` still work to help the user diagnose the issue.

### Auth Mode Capabilities

| Endpoint | OAuth JWT | API Token (`ghi-*`) | Unauthenticated |
|---|---|---|---|
| `/search` | Full access | Full access | Blocked |
| `/languages` | Full access | Full access | Blocked |
| `/feedbacks` | Full access | Full access | Blocked |

Package/source access is different from the REST endpoints above:

- the CLI resolves the package/source service URL from `GITHITS_CODE_NAV_URL`; in the default production environment it falls back to `https://pkgseer.dev`, but custom GitHits environments must set this explicitly
- MCP registration for `search`, `search_status`, `package_*`, `code_files`, `code_read`, and `code_grep` happens only when the current token explicitly carries `code_navigation`
- CLI registration for top-level `search` / `search-status` plus the hidden `githits code` / `githits pkg` groups uses the same capability check, with one local-development escape hatch: `GITHITS_CODE_NAVIGATION=1`
- if the capability is absent or unknown, those indexed tools and command groups are omitted from the surfaced interface

## Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| `GITHITS_MCP_URL` | Override MCP server URL | `http://localhost:7071/mcp` |
| `GITHITS_API_URL` | Override REST API URL | `http://localhost:8000` |
| `GITHITS_CODE_NAV_URL` | Override package/source service URL | `http://localhost:4000` |
| `GITHITS_API_TOKEN` | API token for authentication | `ghi-abc123...` |
| `GITHITS_CODE_NAVIGATION` | Override capability gate and expose hidden indexed `search` / `code` / `pkg` CLI surfaces locally | `1` |
| `GITHITS_TELEMETRY` | Emit end-of-run timing spans to stderr for local profiling | `1` |

## Local Storage

All configuration lives in `~/.githits/`:

```
~/.githits/           (0700)
  auth.json           (0600) — OAuth tokens keyed by MCP URL
  client.json         (0600) — DCR client registrations keyed by MCP URL
```

The secure file permissions prevent other users from reading tokens. When writing new files to `~/.githits/`, use `FileSystemService` rather than `node:fs` directly — this enables testing via mock implementations from `src/services/test-helpers.ts`.

## How Config Flows Through the System

```
Environment variables
  └─ src/services/config.ts (getMcpUrl, getApiUrl, getEnvApiToken)
       └─ src/container.ts (createContainer)
            ├─ mcpUrl → passed to auth commands, used as storage key
            ├─ apiUrl → passed to GitHitsServiceImpl constructor
            ├─ codeNavigationUrl → passed to CodeNavigationServiceImpl when configured
            ├─ apiToken → resolved from env var or OAuth storage
            ├─ hasValidToken → gates authenticated commands
            └─ codeNavigationCapability / CLI override → gates code navigation exposure
```

Commands receive the full `Dependencies` object. Services receive only what they need (e.g., `GitHitsServiceImpl` gets `apiUrl` and `token`).

## Troubleshooting

- **"Authentication required" despite having a token** — Token may be expired and refresh failed. Run `githits login` to re-authenticate.
- **Custom environment not working** — Make sure both `GITHITS_MCP_URL` and `GITHITS_API_URL` are set. They point to different services.
- **Tokens from wrong environment** — Tokens are stored per MCP URL. If you switched `GITHITS_MCP_URL`, you need to re-authenticate for the new URL.

## Key Reference Files

| File | What it demonstrates |
|---|---|
| `src/services/config.ts` | URL and token resolution from environment |
| `src/container.ts` | Auth priority logic and dependency wiring |
| `src/services/auth-storage.ts` | File-based token storage with secure permissions |
| `src/services/filesystem-service.ts` | File system abstraction for testable storage |
| `src/commands/auth-status.ts` | Diagnosing current auth state (reached via `githits auth status`) |
| `src/commands/mcp.ts` | MCP tool registration and deferred-auth startup behavior |
