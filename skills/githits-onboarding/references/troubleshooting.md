# GitHits Onboarding Troubleshooting

Use these recovery paths only when the main onboarding flow fails or the environment prevents normal setup.

## No Shell Access

If you cannot run shell commands, explain that you cannot complete setup directly from the agent. Provide commands only if the user asks for manual steps.

## npx Unavailable

`npx -y githits@latest` requires Node/npm tooling. If `npx` is unavailable, try an already installed `githits` binary. Otherwise explain that Node/npm or the GitHits CLI is required before agent-driven setup can continue.

## No Supported Tools Detected

`init --detect-agents --json` detects supported coding tools and their GitHits MCP state. If no supported tools are detected, report that GitHits can still be used through the CLI where available, but automatic MCP setup needs a supported agent installed or detectable on this machine.

## Browser Does Not Open

Retry login with:

```bash
npx -y githits@latest login --no-browser
```

Ask the user to open the printed URL. Do not ask them to paste passwords, tokens, cookies, or OAuth codes into chat.

## Authentication Timeout

The login link expires after the timeout. Run a fresh login command to create a new link:

```bash
npx -y githits@latest login
```

Use `--no-browser` only if browser launch failed or the environment is headless.

## Keychain Or Storage Failure

If the CLI reports it cannot persist OAuth credentials, ask the user to unlock their system keychain and retry login.

For automation or CI, the user can provide `GITHITS_API_TOKEN` in the environment outside chat. Do not ask them to paste the token into chat.

As a last resort, the user can set `GITHITS_AUTH_STORAGE=file`, but warn that file storage is plaintext on disk.

## Install-Agent Failures

For `init --install-agents <ids> --json`, inspect `outcomes`. Report each failed tool by `name` and `message`. Do not retry with `init -y` or `init --yes` unless the user explicitly approves configuring every detected tool.

## Verification Fails

After setup, run:

```bash
npx -y githits@latest auth status
npx -y githits@latest init --detect-agents --json
```

If auth is active but selected tools are not `already_configured`, report the specific mismatch and failed tool state. If tools are configured, tell the user to open a new agent session so MCP config changes are loaded.
