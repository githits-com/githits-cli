---
"githits": minor
"@githits/mcp": minor
---

- **Use compact MCP targets** - `search`, `code_files`, `code_grep`, and experimental `code_diff` now require target strings: migrate `{registry:"npm",package_name:"express",version:"5.2.1"}` to `"npm:express@5.2.1"`, `{repo_url:"https://github.com/expressjs/express",git_ref:"main"}` to `"github:expressjs/express#main"`, and search `{site:"https://expressjs.com/"}` to `"site:expressjs.com"`; CLI syntax is unchanged.
