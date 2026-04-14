# githits

Code examples from global open source for developers and AI assistants.

GitHits gives your AI coding assistant access to verified, canonical code examples drawn from all of open source. When your assistant is stuck, needs an up-to-date API example, or encounters a vague error, GitHits helps it find a working solution in seconds.

## Quick Start

```sh
npx githits login
```

This opens your browser to authenticate with your [GitHits](https://githits.com) account. Once logged in, set up your AI assistant:

### MCP Setup (works in all agents)

Use this server command in MCP configuration files:

```sh
npx -y githits mcp start
```

**Claude Code**

```sh
claude mcp add githits -- npx -y githits mcp start
```

**Cursor / VS Code**

Add to your MCP settings JSON:

```json
{
  "mcpServers": {
    "githits": {
      "command": "npx",
      "args": ["-y", "githits", "mcp", "start"]
    }
  }
}
```

### Plugin Installation (Open Plugin standard)

The npm package includes Open Plugin-compatible files:

- `.plugin/plugin.json` (vendor-neutral, used by Cursor/Codex/Copilot-compatible hosts)
- `.claude-plugin/plugin.json` (Claude Code compatibility)
- `.claude-plugin/marketplace.json` (Claude Code marketplace catalog)
- `.mcp.json`, `skills/`, and `commands/`

**Claude Code marketplace install**

```sh
/plugin marketplace add githits-com/githits-cli
/plugin install githits@githits-plugins
```

For plugin-based hosts, install from npm/GitHub using your agent's plugin workflow and enable plugin `githits`.

### Agent Coverage

- **Cursor**: reads vendor-neutral `.plugin/` for Open Plugin installs
- **Claude Code**: supports `.claude-plugin/` and Open Plugin components
- **Codex**: supports Open Plugin components
- **GitHub Copilot**: supports Open Plugin components

That's it. Your assistant now has a `search` tool it will use automatically when it needs code examples.

## How It Works

GitHits runs as an [MCP server](https://modelcontextprotocol.io/) that your AI assistant connects to over stdio. The assistant gets three tools:

| Tool | Purpose |
|---|---|
| `search` | Find code examples by describing what you need in natural language |
| `search_language` | Look up supported programming language names |
| `feedback` | Rate search results to improve future quality |

The assistant decides when to call these tools on its own — typically when it's stuck, needs a working example for an unfamiliar API, or encounters an error it can't resolve from its training data alone.

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
githits login          Authenticate with your GitHits account
githits logout         Remove stored credentials
githits mcp            Show setup instructions in a terminal; starts MCP server when piped
githits mcp start      Always start MCP server (for use in MCP config files)
githits auth status    Show current authentication status
```

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `GITHITS_API_TOKEN` | API token for authentication | — |
| `GITHITS_MCP_URL` | Override MCP server URL | `https://mcp.githits.com` |
| `GITHITS_API_URL` | Override REST API URL | `https://api.githits.com` |

## Requirements

- Node.js 20 or later

## License

Apache-2.0
