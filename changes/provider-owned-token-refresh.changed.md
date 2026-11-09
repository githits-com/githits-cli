---
"githits": none
"@githits/mcp": patch
---

- **Provider-owned token refresh** - Remove API-key prefix checks from request recovery. Built-in static credentials still preserve backend errors without retrying, and OAuth refresh is unchanged. Custom token providers now control refresh regardless of token format and must return `undefined` when refresh is unsupported.
