# Remote Browser Authentication

## CLI behavior

GitHits authenticates native CLI sessions with an OAuth authorization-code
flow and PKCE. Its temporary callback server is bound to `127.0.0.1` on the
host running the CLI.

The `init` and `login` commands share one browser-auth option registration and
one login flow:

- `--no-browser` prevents automatic browser launching.
- `--port <port>` selects the loopback callback port.
- invalid CLI and programmatic port values are rejected by shared validation;
- manual-browser output identifies the listener and prints an SSH
  local-forward command using the effective port.

When no port is supplied, the login flow continues to reuse a stored client's
redirect URI or select a port in its existing random range.

## Documentation handoff

Hosted authentication and command-reference content should distinguish three
cases:

1. A browser on the GitHits host can use the loopback callback directly.
2. A browser on another computer needs an SSH local forward and the same
   explicit port on `init` or `login`.
3. An unattended process should authenticate with `GITHITS_API_TOKEN`, not an
   interactive callback.

The README and CLI command reference in this repository provide the current
commands and wording to carry into hosted documentation.

## Future tunnel-free flow

Avoiding SSH forwarding requires an OAuth server flow designed for devices
without a local browser. The standards-based direction is the OAuth 2.0 Device
Authorization Grant (RFC 8628). That work requires authorization-server
endpoints, verification UI, expiring device/user codes, polling semantics, and
abuse controls before the CLI can support it.
