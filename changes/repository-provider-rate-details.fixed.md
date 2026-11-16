---
"githits": patch
"@githits/mcp": patch
---

- **Repository provider throttling** - Preserve temporary provider rate limits, safe scope/source and repository facts, and precise retry timing (including timed recovery in text) through package/source, navigation, changelog and diff errors in CLI and MCP without retrying before reset or hiding existing partial evidence; package overviews retain readable facts with explicit temporary metadata errors.
