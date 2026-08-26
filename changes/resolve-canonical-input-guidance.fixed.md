---
"githits": patch
"@githits/mcp": none
---

- **Reject canonical resolve inputs locally** - `githits resolve` and local `resolve_target` now direct already-canonical package and GitHub repository targets to the next GitHits tool without calling the resolver backend.
