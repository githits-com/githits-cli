---
"githits": minor
"@githits/mcp": minor
---

- **Package-only changelog targets** - MCP `pkg_changelog` replaces `registry`, `package_name`, `repo_url`, `git_ref`, `from_version`, and `to_version` with one required `target` (`npm:express`, `npm:express@5.2.1`, or `npm:express@4.21.2..5.2.1`). CLI drops `--repo-url` and `--git-ref`, accepts the same package forms, and keeps `--from`/`--to` as package range flags. Exact pins return one selected release or `VERSION_NOT_FOUND`; empty timeline selections succeed instead of becoming `NOT_FOUND`.
