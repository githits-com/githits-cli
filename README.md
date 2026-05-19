# githits

Code examples from global open source for developers and AI assistants.

GitHits gives your AI coding assistant access to verified, canonical code examples drawn from all of open source. When your assistant is stuck, needs an up-to-date API example, or encounters a vague error, GitHits helps it find a working solution in seconds.

## Quick Start

```sh
npx githits init
```

`init` authenticates with your [GitHits](https://githits.com) account, then auto-detects your installed coding tools and configures each one with GitHits MCP.

Supported tools: Claude Code, Cursor, Windsurf, VS Code / Copilot, Cline, Claude Desktop, Codex CLI, Pi, Gemini CLI, Google Antigravity, and OpenCode.

If you are using a tool that is not listed above, use the manual MCP setup instructions near the end of this README.

### Plugin Installation (Open Plugin standard)

The npm package includes Open Plugin-compatible files:

- `.plugin/plugin.json` (vendor-neutral, used by Cursor/Codex/Copilot-compatible hosts)
- `.claude-plugin/plugin.json` (Claude Code compatibility)
- `.claude-plugin/marketplace.json` (Claude Code marketplace catalog)
- `.mcp.json` (Open Plugin MCP server config for plugin hosts)
- `plugins/claude/` (Claude plugin runtime payload: `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, and `commands/`)

Root `.claude-plugin/marketplace.json` provides marketplace metadata. Claude Code
loads the plugin runtime payload from `plugins/claude/`.

**Claude Code Plugin (Marketplace)**

Install from terminal (recommended):

```sh
claude plugin marketplace add githits-com/githits-cli
claude plugin install githits@githits-plugins
```

This is preferred over in-session install so the plugin is loaded cleanly on
next `claude` launch.

Alternative (inside Claude input):

```sh
/plugin marketplace add githits-com/githits-cli
/plugin install githits@githits-plugins
```

If installed inside a running Claude session, reload/restart Claude if the
plugin is not immediately available.

For unpublished/local testing of this repository:

```sh
claude plugin marketplace add "$PWD"
claude plugin install githits@githits-plugins
```

By default, the plugin starts MCP with `npx -y githits@latest mcp start` so installs track the latest published GitHits CLI.

For unpublished/local testing, install from your local repository path and verify behavior in your host before publishing.

In Claude Code, run `/mcp` and confirm `plugin:githits:githits` is listed for the plugin path.

Note: when running Claude in this repository directory, root `.mcp.json` can also register `githits` for project-level MCP. For plugin-only attribution during testing, run Claude from a different working directory.

**Gemini CLI extension install**

```sh
gemini extensions install https://github.com/githits-com/githits-cli
```

For plugin-based hosts, install from npm/GitHub using your agent's plugin workflow and enable plugin `githits`.

### Agent Coverage

- **Cursor**: reads vendor-neutral `.plugin/` for Open Plugin installs
- **Claude Code**: supports `.claude-plugin/` and Open Plugin components
- **Codex**: supports Open Plugin components
- **GitHub Copilot**: supports Open Plugin components
- **Gemini CLI**: supports `gemini-extension.json` and `GEMINI.md`

That's it. Your assistant now has GitHits example-search tools and indexed dependency/package inspection tools.

## How It Works

GitHits runs as an [MCP server](https://modelcontextprotocol.io/) that your AI assistant connects to over stdio.

Core tools available in every authenticated session:

| Tool | Purpose |
|---|---|
| `get_example` | Find canonical code examples by describing what you need in natural language |
| `search_language` | Look up supported programming language names |
| `feedback` | Submit result or session feedback to improve future quality |

The assistant decides when to call these tools on its own — typically when it's stuck, needs a working example for an unfamiliar API, or encounters an error it can't resolve from its training data alone.

GitHits also exposes indexed package/source tools:

| Tool | Purpose |
|---|---|
| `search` | Unified indexed search across dependency/repository code, docs, and symbols |
| `search_status` | Follow up a prior indexed `search` by `searchRef` |
| `docs_list` | Browse mixed package documentation pages |
| `docs_read` | Read a documentation page by page ID |
| `pkg_info` | Quick package triage: version, license, repository popularity, downloads, vulnerabilities |
| `pkg_vulns` | CVE / OSV advisories for a package or specific version, with filter echo and compact/verbose modes |
| `pkg_deps` | Direct dependencies, dependency groups, and optional transitive graph |
| `pkg_changelog` | Release notes / changelog entries for a package or GitHub repo, with compact timeline and body-preview controls |
| `pkg_upgrade_review` | Evidence for dependency upgrades, including vulnerabilities, changelog entries, deprecation metadata, peer changes, and dependency changes |
| `code_files` | Discover what files a dependency or repo contains |
| `code_read` | Read a dependency file by path |
| `code_grep` | Deterministic text grep across indexed dependency or repo files |

### License Filtering

Search results respect license filtering by default, excluding copyleft-licensed code. Three modes are available:

- **strict** (default) — excludes copyleft licenses
- **yolo** — includes all licenses, no filtering
- **custom** — uses your custom blocklist configured at [githits.com](https://githits.com)

## Authentication

GitHits requires authentication. There are two options:

### Browser Login (recommended)

```sh
npx githits login
```

Opens your browser for secure OAuth authentication. Tokens are stored in the system keychain by default and refreshed automatically on next use. If a refresh fails (for example, after an extended idle period), run `githits login` again.

Useful flags:

- `--no-browser` — prints a URL instead of opening a browser (for SSH sessions, CI, or headless environments)
- `--force` — re-authenticate even if already logged in
- `--port <port>` — use a specific port for the local callback server

### API Token

For CI or environments where browser login isn't practical, set an environment variable:

```sh
export GITHITS_API_TOKEN=ghi-your-token-here
```

### Keychain Prompts and File Storage

GitHits uses the system keychain by default because OAuth credentials include a refresh token. On macOS this means Keychain Access; on Windows it means Credential Manager; on Linux it means the available Secret Service or keyring backend.

If macOS shows a prompt such as "githits wants to access ... in your keychain", choose **Always Allow** when you trust the installed `githits` CLI. GitHits cannot customize that operating-system prompt with extra explanation; it is generated by macOS.

GitHits also writes a small non-secret metadata file so recent startup checks do not need to read the keychain. The keychain is only read when GitHits actually needs the token, for example during a tool call, token refresh, `githits auth status`, or a login check after metadata is stale or expired.

If your agent keeps showing keychain prompts even after **Always Allow**, switch OAuth storage to file mode:

```toml
# macOS/Linux: ~/.config/githits/config.toml, or $XDG_CONFIG_HOME/githits/config.toml
# Windows: %APPDATA%\githits\config.toml
[auth]
storage = "file"
```

The config directory may be empty until you create `config.toml` or GitHits writes auth metadata. Older macOS installs may have used `~/Library/Application Support/githits`; GitHits still reads that location for migration, but new auth config and file storage use `~/.config/githits`.

You can also opt in for one process:

```sh
GITHITS_AUTH_STORAGE=file githits login --force
```

File mode stores OAuth credentials as JSON files under the GitHits config directory. The files are written with private permissions where the platform supports it, but they are not encrypted. Any process that can read files as your operating-system user may be able to read the tokens.

Use file mode only on machines where you trust local user-account access. For CI and automation, prefer `GITHITS_API_TOKEN` instead of browser OAuth.

To inspect the current auth setup, run:

```sh
githits auth status
```

## Commands

```
githits init             Authenticate and configure your coding tools with GitHits MCP
githits init uninstall   Remove GitHits MCP configuration from your coding tools
githits login            Authenticate with your GitHits account (also runs as part of init)
githits logout           Remove stored credentials
githits mcp              Show setup instructions in a terminal; starts MCP server when piped
githits mcp start        Always start MCP server (for use in MCP config files)
githits auth status      Show current authentication status
githits example          Get canonical code examples from global open source
githits languages        List or filter supported language names
githits feedback         Send feedback on a result, command, or session
```

These indexed package/source commands are also available:

```
githits search ...     Unified indexed dependency/repository search
githits search-status  Follow up a prior indexed search
githits pkg ...        Package metadata: overview, advisories, deps, changelog, upgrade reviews
githits docs ...       Package documentation: browse pages and read content
githits code ...       Dependency source inspection: search, files, read, grep
```

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `GITHITS_API_TOKEN` | API token for authentication | — |
| `GITHITS_AUTH_STORAGE` | Override OAuth storage mode (`keychain` or `file`) | `keychain` |
| `GITHITS_MCP_URL` | Override MCP server URL | `https://mcp.githits.com` |
| `GITHITS_API_URL` | Override REST API URL | `https://api.githits.com` |
| `GITHITS_CODE_NAV_URL` | Override package/source service URL | `https://pkgseer.dev` |
| `GITHITS_TELEMETRY` | Emit end-of-run timing spans to stderr for local profiling | — |
| `GITHITS_DISABLE_UPDATE_CHECK` | Disable npm latest-version update notices | — |

## Manual Setup

If your tool is not in the supported `githits init` list, configure GitHits manually.

The same MCP server command exposes both the core example-search tools and the indexed package/source inspection tools. No separate install is required.

Use this MCP server command in your tool's MCP config (the host/agent runs this command):

```sh
npx -y githits@latest mcp start
```

A typical MCP config looks like this (check your tool's docs for exact schema/key names):

```json
{
  "mcpServers": {
    "githits": {
      "command": "npx",
      "args": ["-y", "githits@latest", "mcp", "start"]
    }
  }
}
```

If you'd like another tool to be included in `githits init` for auto-configuration, open an issue or PR.

To undo automatic setup, run `githits init uninstall`. It removes only GitHits MCP/plugin configuration and preserves stored credentials; use `githits logout` separately to remove credentials.

## Development

```sh
bun run build
npm link
githits --version
```

After the initial `npm link`, only `bun run build` is needed for subsequent changes.

## Requirements

- Node.js 24 or later

## License

Apache-2.0
