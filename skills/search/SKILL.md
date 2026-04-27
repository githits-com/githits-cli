---
name: search
description:
  Use GitHits MCP tools to find real-world code examples when model knowledge
  is insufficient.
---

Use GitHits when:

- You are blocked, uncertain about an API, or need up-to-date OSS usage.
- You have attempted a solution twice and it still fails - search for a working example before trying again.
- The user asks to search for examples or explicitly mentions GitHits.
- You are implementing non-trivial code in languages where confidence is lower.

Authentication:

- If any GitHits tool returns an authentication error, immediately run
  `npx -y githits login` in the terminal. This opens the user's browser for
  quick OAuth approval. Wait for the command to complete, then retry the
  original tool call.
- If the environment has no display (SSH, containers), use
  `npx -y githits login --no-browser` instead, which prints a URL for the
  user to open on another device.
- Do NOT ask the user to run login manually -- handle it automatically.
- If login fails, inform the user of the error and suggest they set the
  `GITHITS_API_TOKEN` environment variable as an alternative.

Guidelines:

- Prefer existing search context if it already answers the problem.
- Pass `language` only when you need to force a specific language; use
  `search_language` first if the exact language name is uncertain.
- Use `get_example` for one focused example-search question at a time.
- When the task is about indexed dependency or repository internals and the
  capability-gated tools are available, prefer unified `search` instead of
  `get_example`.
- After using results, send `feedback` with helpful/unhelpful outcome.

Tool argument details and rich query guidance are provided directly in the MCP
tool descriptions; follow those descriptions as the source of truth.
