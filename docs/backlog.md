# Backlog

## Production schema gate for uniform indexing estimates

Before releasing the uniform indexing preparation client change, verify production
deployment of backend PR #2980 and support for every selected result-level array.
Dev deployment and authenticated pending/ready checks passed; production support
has not been verified. See [the contract](implementation/indexing-estimates.md).
Hosted adoption also requires the released MCP package and remote-mcp dependency
update/deployment. Each merge, release, publish and deployment needs separate
direct user approval.

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

On 2026-10-05, authenticated dev MCP stable smoke passed; the experimental
Research initial JSON succeeded in107.1s, then its URL-source thread follow-up
failed the expected-success assertion after200.4s. The assertion did not expose
the underlying error code, so this is additional Research investigation evidence,
not a confirmed diagnosis or regression in indexing metadata. No client timeout
or retry workaround was added.
