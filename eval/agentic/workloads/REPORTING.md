At the end, return valid JSON matching the provided schema. Include:

- `status`: `success`, `failure`, or `inconclusive`.
- `answer`: your final answer with evidence.
- `toolIssues`: string descriptions of GitHits tool calls that failed or
  returned unclear output, if any.
- `expectedToolUse`: optional string list of GitHits tools you expected to use
  for this workload.
- `unexpectedToolUse`: optional string list of tools or fallback paths you used
  but did not expect to need.
- `instructionIssues`: MCP guidance that was unclear, missing, or contradicted
  observed tool behavior, if any.
- `githitsUsefulness`: `helped`, `hurt`, `unused`, or `unclear`.
- `githitsUsefulnessReason`: why you chose that usefulness value.
- `confidence`: `high`, `medium`, or `low`.
