# Troubleshooting GitHits setup

## Configured, but GitHits tools are missing

Open a new agent session so it loads the MCP configuration and any installed
skills. In your agent's MCP settings, check that GitHits is enabled and complete
its sign-in prompt. A successful configuration write does not prove that the
agent has signed in or loaded the tools.

To inspect the detected connections without changing configuration:

```sh
npx githits@latest init --detect-agents
```

For project-level setup, add `--project`. This reports configuration status;
it does not test an authenticated MCP tool call.

## Cursor

Open **Customize > MCPs**, select **GitHits**, and follow the sign-in prompts.
If you use Cursor CLI, sign in with:

```sh
agent mcp login GitHits
```

Then inspect the connection and available tools:

```sh
agent mcp list
agent mcp list-tools GitHits
```

Open a new Cursor Agent chat and check that GitHits tools are available.
Cursor manages its own OAuth session. Signing in to the GitHits CLI does not
sign Cursor in.

## Other remote MCP connections

Use the sign-in action in the selected agent. Claude Code exposes it through
`/mcp`; Codex CLI uses `codex mcp login githits`; Gemini CLI uses
`/mcp auth githits`; OpenCode uses `opencode mcp auth GitHits`; Pi uses
`/mcp-auth GitHits`; Kilo Code uses `kilo mcp auth GitHits`. Other supported
editors expose GitHits authentication in their MCP settings.

After sign-in, open a new agent session and check that GitHits tools are
available. If sign-in was skipped during setup, you can complete it in the
agent without reinstalling GitHits.

Claude Desktop connects through the
[GitHits directory page](https://claude.ai/directory/githits). Connect and sign
in there; rerunning CLI setup cannot activate that account-level connector.

## Local MCP or direct CLI authentication

Local integrations use the GitHits CLI's authentication, separate from remote
agents' OAuth sessions:

```sh
npx githits@latest auth status
npx githits@latest login
```

For runtime and connectivity diagnostics:

```sh
npx githits@latest doctor
```

See the [authentication documentation](https://docs.githits.com/authentication)
for keychain, file-storage and CI configuration.

## Setup reports a configuration error

Inspect the file named by the error. Check permissions, file syntax and the
GitHits MCP entry before rerunning setup for that tool. Init leaves malformed,
unreadable or disabled entries unchanged rather than replacing them silently.

If one tool fails while another succeeds, fix only the failed tool. Completed
connections retain their sign-in steps and do not need reinstalling.
