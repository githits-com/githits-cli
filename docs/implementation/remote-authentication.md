# Remote Authentication

## Current CLI contract

GitHits uses an OAuth authorization-code flow with PKCE and a callback listener
bound to `127.0.0.1` on the machine running the CLI. This is a local native-app
flow: `--no-browser` suppresses browser launching, but it does not make the
callback reachable from a browser on another computer.

For interactive SSH use, both `init` and `login` accept `--port <port>`. The
user can prepare SSH local forwarding for that port, start GitHits remotely
with `--no-browser --port <port>`, and open the printed URL locally. When no
port is supplied, existing random-port and stored-client behavior is preserved.

For non-interactive environments, `GITHITS_API_TOKEN` is the supported path.
OAuth callback flows should not be used for unattended processes.

## Hosted documentation handoff

The separately hosted authentication and command-reference pages should state
the following explicitly:

- `--no-browser` changes browser launching only.
- The callback listener remains on the GitHits host's loopback interface.
- A different browser computer requires SSH local forwarding using the same
  port passed to `init` or `login`.
- API tokens are intended for CI and genuinely non-interactive environments.

The README and CLI command reference in this repository contain the canonical
wording and forwarding example for that update.

## Tunnel-free authentication

A tunnel-free remote flow requires server support and is outside this
repository. The preferred follow-up is the OAuth 2.0 Device Authorization Grant
(RFC 8628), not a custom copy/paste or polling protocol.

Required server capabilities include:

- a device-authorization endpoint and OAuth discovery metadata;
- a user verification page with short-lived user and device codes;
- token-endpoint polling with pending, slowdown, denial, and expiry outcomes;
- rate limiting, code entropy, expiry, and phishing protections.

After those capabilities exist, the CLI can add an explicit `--device-code`
mode to `login` and `init`. `--no-browser` should remain a browser-launch option
so the CLI continues to distinguish launch behavior from the OAuth protocol.
