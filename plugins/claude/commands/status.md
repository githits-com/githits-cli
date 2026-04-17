---
description: Show your GitHits authentication status
---

# Status

Check the user's current GitHits authentication status by running the CLI
command in the terminal:

```
npx -y githits auth status
```

This shows whether the user is authenticated, where credentials are sourced
from, and token expiry details when available.

After running the command, report the status clearly. If the user is not
authenticated, suggest running:

```
npx -y githits login
```
