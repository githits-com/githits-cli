---
"githits": minor
"@githits/mcp": minor
---

- **Compact package tool targets** - MCP `docs_list`, `pkg_info`, `pkg_vulns`, and `pkg_deps` replace `registry`, `package_name`, and `version` inputs with string `target` (for example `npm:express@5.2.1`); `pkg_info` requires an unpinned latest-only target. CLI syntax, filters, and service requests are unchanged; output is unchanged except that `docs_list` retry hints use the new target syntax. `pkg_changelog` and `pkg_upgrade_review` retain their structured inputs.
