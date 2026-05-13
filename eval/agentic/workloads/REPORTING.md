Return only valid JSON matching the provided schema. Do not include markdown,
prose, code fences, or any text outside the JSON object. Include:

- `status`: `success`, `failure`, or `inconclusive`.
- `answer`: your final answer with evidence as a string.
- `toolIssues`: string list of GitHits MCP tool calls or CLI commands that
  failed or returned unclear output. Use `[]` if none.
- `expectedToolUse`: string list of GitHits MCP tools or CLI commands you
  expected to use for this workload. Use `[]` if none.
- `unexpectedToolUse`: string list of tools or fallback paths you used but did
  not expect to need. Use `[]` if none.
- `instructionIssues`: string list of GitHits guidance that was unclear,
  missing, or contradicted observed behavior. Use `[]` if none.
- `githitsUsefulness`: `helped`, `hurt`, `unused`, or `unclear`.
- `githitsUsefulnessReason`: why you chose that usefulness value.
- `confidence`: `high`, `medium`, or `low`.
