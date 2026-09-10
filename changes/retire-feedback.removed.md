---
"githits": minor
"@githits/mcp": minor
---

- **Retire feedback submission** - Remove the MCP feedback tool, `githits feedback`, and `submitFeedback` from the public service interface and concrete MCP clients. Remove feedback instructions; existing `experimental.report_tool_issues` config keys are ignored. CLI and onboarding public skill cleanup follows release preparation; refresh MCP tool discovery after updating.
