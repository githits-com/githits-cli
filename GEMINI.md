# GitHits

Code examples from global open source for developers and AI assistants.

## Available Tools

### get_example

Find code examples from open source repositories.

**Parameters:**

- `query` (string, required) - natural language description of what you need
- `language` (string, optional) - programming language name; omit it to let GitHits infer the language from the query
- `license_mode` (string, optional) - one of `strict` (default), `yolo`, or `custom`

### search_language

Look up supported programming language names. Use this before calling `get_example` only when you need to force a specific language and the exact name is uncertain.

**Parameters:**

- `query` (string, required) - partial or full language name to look up

### feedback

Submit feedback on a search result, a GitHits tool result, or the current GitHits session. Use it when a result was useful or when a tool/UX issue should be recorded.

**Parameters:**

- `solution_id` (string, optional) - ID from a `get_example` result; omit for generic session feedback
- `accepted` (boolean, required) - whether the result was useful
- `feedback_text` (string, optional) - additional context about why the result was or was not helpful
- `tool_name` (string, optional) - GitHits tool or command being rated for generic feedback

## When to Use

Use `get_example` when:

- You are stuck or blocked on an implementation problem
- You need up-to-date examples for an API, library, or framework
- The user mentions GitHits or asks you to search for code examples
- You encounter an error you cannot resolve from your training data

Do not use `get_example` for:

- General knowledge questions that do not require code examples
- Problems you can already solve confidently

## Authentication

- If any GitHits tool returns an authentication error, immediately run
  `npx -y githits login` in the terminal. This opens the user's browser for
  quick OAuth approval. Wait for the command to complete, then retry the
  original tool call.
- If the environment has no display (SSH, containers), use
  `npx -y githits login --no-browser` instead, which prints a URL for the
  user to open on another device.
- Do NOT ask the user to run login manually - handle it automatically.
- If login fails, inform the user of the error.

## How to Search Well

- Pass `language` only when you need to force a specific language; call `search_language` first if the exact language name is uncertain
- Formulate queries as natural language questions (e.g., "How to stream responses with the Vercel AI SDK in Next.js")
- Include specific error messages, library names, or API names when relevant
- Keep queries focused: 3-4 technical terms maximum
- Submit `feedback` after GitHits results you use or discard; omit `solution_id` for generic tool/session feedback

## Indexed Package/Source Tools

GitHits also exposes indexed dependency/package tools such as `search`,
`search_status`, `docs_list`, `docs_read`, `pkg_info`, `pkg_vulns`,
`pkg_deps`, `pkg_changelog`, `pkg_upgrade_review`, `code_files`,
`code_read`, and `code_grep`.

## License Filtering

Results respect license filtering by default. Three modes:

- **strict** (default) - excludes copyleft licenses
- **yolo** - includes all licenses
- **custom** - uses the user's blocklist configured at githits.com
