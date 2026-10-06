---
"githits": minor
"@githits/mcp": minor
---

- **Readable MCP errors** - Default and explicit text responses now explain failures in readable text, including early validation and service-provider failures. Request `format: "json"` when parsing the structured error envelope; its error codes, retryability and supplied metadata remain available.
