# GitHits Onboarding Troubleshooting

Use these recovery paths only when the main onboarding flow fails or the environment prevents normal setup.

## No Shell Access

If you cannot run shell commands, explain that you cannot complete setup directly from the agent. Provide commands only if the user asks for manual steps.

## npx Unavailable

`npx -y githits@latest` requires Node/npm tooling. If `npx` is unavailable, explain that Node/npm is required before normal onboarding can continue. Do not fall back to a globally installed CLI. Use a local or pinned command only when the user explicitly requested that testing mode, preserving their command and environment.

## No Supported Tools Detected

`init --detect-agents --json` detects supported coding tools and their GitHits MCP state. If no supported tools are detected, report that GitHits can still be used through the CLI where available, but automatic MCP setup needs a supported agent installed or detectable on this machine.

## Browser Does Not Open

Retry login with:

```bash
npx -y githits@latest login --no-browser
```

Surface the printed sign-in URL clearly so the user can open it in a browser. If command output is hidden from the user, relay the URL verbatim. Do not ask them to paste passwords, tokens, cookies, or OAuth codes into chat.

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

Follow the CLI-emitted verification instruction for the selected setup scope. Preserve `--project` for project setup and `--no-guidance` when guidance was declined; do not substitute a user-level detection command. Report the specific mismatch if selected tools are not `already_configured`.

For local CLI/stdio integrations, check `npx -y githits@latest auth status` (or the user-requested local/pinned command). For Cursor, follow the main skill's Cursor verification flow: local CLI authentication and `already_configured` do not establish Cursor readiness. Skip local CLI authentication for Cursor-only setup; verify Cursor-managed OAuth and tool discovery in a new Cursor Agent chat, using `cursor-agent` when available. For mixed setups, verify each authentication path separately.

After MCP configuration or supporting guidance changes, tell the user to open a new coding-agent session. The terminal and machine do not need to be restarted.
