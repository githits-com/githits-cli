---
"githits": patch
"@githits/mcp": patch
---

- **Upgrade verification workflow** - The shared `githits-mcp` skill and `quick_start` routing guide now instruct dependency-upgrade agents to record a baseline of API responses, stored values, and side effects beyond existing tests before upgrading, compare after upgrading, fix unintended differences, and report verification gaps.
