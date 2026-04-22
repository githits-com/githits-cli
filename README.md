# githits

Code examples from global open source for developers and AI assistants.

GitHits gives your AI coding assistant access to verified, canonical code examples drawn from all of open source. When your assistant is stuck, needs an up-to-date API example, or encounters a vague error, GitHits helps it find a working solution in seconds.

## Quick Start

```sh
npx githits init
```

`init` authenticates with your [GitHits](https://githits.com) account, then auto-detects your installed coding tools and configures each one with GitHits MCP.

Supported tools: Claude Code, Cursor, Windsurf, VS Code / Copilot, Cline, Claude Desktop, Codex CLI, Gemini CLI, and Google Antigravity.

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

That's it. Your assistant now has GitHits search tools, and on accounts with package/source access enabled it also gets dependency inspection tools.

## How It Works

GitHits runs as an [MCP server](https://modelcontextprotocol.io/) that your AI assistant connects to over stdio.

Core tools available in every authenticated session:

| Tool | Purpose |
|---|---|
| `search` | Find code examples by describing what you need in natural language |
| `search_language` | Look up supported programming language names |
| `feedback` | Rate search results to improve future quality |

The assistant decides when to call these tools on its own — typically when it's stuck, needs a working example for an unfamiliar API, or encounters an error it can't resolve from its training data alone.

When package/source access is enabled for the current token, GitHits also exposes these capability-gated tools:

| Tool | Purpose |
|---|---|
| `package_summary` | Quick package overview: version, license, downloads, quickstart, advisories |
| `package_vulnerabilities` | CVE / OSV advisories for a package or specific version |
| `package_dependencies` | Direct dependencies, dependency groups, and optional transitive graph |
| `package_changelog` | Release notes / changelog entries for a package or GitHub repo |
| `search_symbols` | Exact-token search inside indexed dependency source |
| `list_files` | Discover what files a dependency or repo contains |
| `read_file` | Read a dependency file by path |
| `grep_file` | Search for a case-insensitive substring within one file |

These advanced tools remain feature-gated. The MCP server advertises them only when the authenticated token is entitled to package/source access.

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

Opens your browser for secure OAuth authentication. Tokens are stored locally and refreshed automatically on next use. If a refresh fails (e.g., after an extended idle period), run `githits login` again.

Useful flags:

- `--no-browser` — prints a URL instead of opening a browser (for SSH sessions, CI, or headless environments)
- `--force` — re-authenticate even if already logged in
- `--port <port>` — use a specific port for the local callback server

### API Token

For CI or environments where browser login isn't practical, set an environment variable:

```sh
export GITHITS_API_TOKEN=ghi-your-token-here
```

## Commands

```
githits init           Authenticate and configure your coding tools with GitHits MCP
githits login          Authenticate with your GitHits account (also runs as part of init)
githits logout         Remove stored credentials
githits mcp            Show setup instructions in a terminal; starts MCP server when piped
githits mcp start      Always start MCP server (for use in MCP config files)
githits auth status    Show current authentication status
```

When package/source access is enabled for the current token, two extra command groups are also available:

```
githits pkg ...        Package metadata: overview, advisories, deps, changelog
githits code ...       Dependency source inspection: search, files, read, grep
```

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `GITHITS_API_TOKEN` | API token for authentication | — |
| `GITHITS_MCP_URL` | Override MCP server URL | `https://mcp.githits.com` |
| `GITHITS_API_URL` | Override REST API URL | `https://api.githits.com` |
| `GITHITS_CODE_NAV_URL` | Override package/source service URL | environment-specific |
| `GITHITS_CODE_NAVIGATION` | Expose hidden `pkg` / `code` command groups locally | — |
| `GITHITS_TELEMETRY` | Emit end-of-run timing spans to stderr for local profiling | — |

## Manual Setup

If your tool is not in the supported `githits init` list, configure GitHits manually.

The same MCP server command exposes both the core search tools and, when your token is entitled, the package/source inspection tools. No separate install is required.

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
