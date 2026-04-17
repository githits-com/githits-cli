---
description: Log in to your GitHits account
---

# Login

Authenticate the user with GitHits by running the CLI login command in the
terminal:

```
npx -y githits login
```

This opens the user's browser for secure OAuth authentication. Tokens are stored
locally and refreshed automatically.

If the environment has no display (SSH, CI, containers), use the `--no-browser`
flag instead:

```
npx -y githits login --no-browser
```

This prints a URL the user can open on another device.

Other useful flags:

- `--force` — re-authenticate even if already logged in.
- `--port <port>` — use a specific port for the local callback server.

After running the command, inform the user of the result. If login succeeds,
confirm they are authenticated. If it fails, provide the error and suggest they
try again.

Alternative: the user can set the `GITHITS_API_TOKEN` environment variable
instead of using browser login.
