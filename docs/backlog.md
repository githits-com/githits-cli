# Backlog

## Investigate production Research timeouts

Observed during 0.24.0 release validation on 2026-09-30. The live local MCP
smoke completed its initial Research JSON request and URL follow-up, then
failed the text follow-up. A separate local MCP request for
`npm:express`, "Where is router dispatch implemented?", returned
`TIMEOUT` with "Research timed out." The service maps that exact message from
HTTP 504; the client request timeout has a different message.

The hosted Research API owns the failed operation. Investigate its execution
and HTTP timeout boundaries, then verify the initial request and both thread
follow-ups through local MCP. The root cause is unverified; no client retry or
timeout workaround is proposed. This requires backend investigation outside
this CLI worktree. Earlier release validation also stalled in experimental
Research, so the evidence does not establish a new 0.24.0 regression. Stable
agent evals exclude this experimental tool.
