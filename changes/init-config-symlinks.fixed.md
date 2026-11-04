---
"githits": patch
"@githits/mcp": none
---

- **Preserve linked agent configuration** - MCP config and instruction setup/removal update the existing symlink target, retaining dotfile-managed links and unrelated settings. Uninstall clears an otherwise empty instruction target while retaining its user-managed link. Credential write behavior is unchanged.
