---
"githits": patch
"@githits/mcp": patch
---

- **Consistent indexing waits and timeout errors** - Default indexing preparation to 30000 ms across search/status, read, list, grep, and direct service clients (including searchStatus changing its omitted wait from zero to 30000 ms); preserve explicit zero and non-waiting unified grep continuation. Allow HTTP headroom for longer waits and classify GraphQL/example response-body expiry as TIMEOUT. At release preparation, update the public CLI code skill and its code-and-docs reference for grep's new default.
