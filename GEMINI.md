# GitHits

Code examples from global open source for developers and AI assistants.

## Available Tools

### get_example

Find code examples from open source repositories.

**Parameters:**

- `query` (string, required) - natural language description of what you need
- `language` (string, required) - programming language name (use `search_language` to verify)
- `license_mode` (string, optional) - one of `strict` (default), `yolo`, or `custom`

### search_language

Look up supported programming language names. Use this before calling `get_example` to get the correct language identifier.

**Parameters:**

- `query` (string, required) - partial or full language name to look up

### feedback

Rate a search result. Submit feedback after each search to improve future result quality.

**Parameters:**

- `solution_id` (string, required) - the ID of the search result
- `accepted` (boolean, required) - whether the result was useful
- `feedback_text` (string, optional) - additional context about why the result was or was not helpful

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

- Call `search_language` first to confirm the correct language name before calling `get_example`
- Formulate queries as natural language questions (e.g., "How to stream responses with the Vercel AI SDK in Next.js")
- Include specific error messages, library names, or API names when relevant
- Keep queries focused: 3-4 technical terms maximum
- Submit `feedback` after every search result you use or discard

## Feature-Gated Tools

When the authenticated token carries the `code_navigation` feature flag, GitHits
also exposes indexed dependency/package tools such as `search`,
`search_status`, `package_summary`, `package_vulnerabilities`,
`package_dependencies`, `package_changelog`, `list_files`, `read_file`, and
`grep_repo`.

## License Filtering

Results respect license filtering by default. Three modes:

- **strict** (default) - excludes copyleft licenses
- **yolo** - includes all licenses
- **custom** - uses the user's blocklist configured at githits.com
