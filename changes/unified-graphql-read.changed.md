---
"githits": minor
"@githits/mcp": minor
---

- **Unify compact reads** - Compact reads now use backend `Query.read`; deprecated reads and `--repo-url` compatibility paths remain on legacy roots so migration usage stays observable. `McpToolServices.readService` is now required, with `ReadService` and `ReadServiceImpl` exported from `@githits/mcp/client` for hosts. Custom `GITHITS_CODE_NAV_URL` or `PKGSEER_URL` endpoints must implement `Query.read` for compact reads.
