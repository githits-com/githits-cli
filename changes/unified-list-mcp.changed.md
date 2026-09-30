---
"githits": minor
"@githits/mcp": minor
---

- **Unify MCP inventory browsing** - Replace the callable `code_files` and
  `docs_list` tools with one `list` tool for package, repository, and explicit
  site inventories; its description retains both retired names for stale tool
  searches, while legacy grouped CLI commands remain available. Hosts must
  provide the now-required `McpToolServices.listService`; `ListService` and
  `ListServiceImpl` are exported from `@githits/mcp/client`. Custom endpoints
  must implement `Query.list` for the unified inventory service. Default text
  includes the opaque `after` continuation when more entries are available.
