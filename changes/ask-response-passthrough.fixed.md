---
"githits": patch
"@githits/mcp": none
---

- **Backend-owned Research display** - Experimental CLI and local MCP Research now display the API's complete Markdown, allowing answer sections and citations to evolve without client releases. JSON preserves the minimal `display_markdown` envelope and optional IDs without response-schema validation. Requires the coordinated backend update; replaces the old structured answer/source JSON contract. Transport limits, error handling, and terminal sanitization remain intact.
