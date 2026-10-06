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

## Investigate unified read preparation metadata at deadline and readiness

Authenticated dev CLI/MCP checks on 2026-10-05 verified the normal pending
read/list estimate and native retry messages. Two edge transitions remain:

- A read of `github:sqlalchemy/sqlalchemy@rel_2_0_0` with `wait_timeout_ms: 1`
  returned `TIMEOUT`, retryable, and no indexing metadata. Its backend message
  was "Repository preparation exceeded waitTimeoutMs before an indexing target
  was available." The CLI cannot infer that indexing has started or invent an
  estimate. Backend target preparation owns the deadline classification and
  available metadata; inspect that path before changing the client contract.
- Bounded readable results for rel_2_0_0 and rel_2_0_1 briefly had provisional
  target resolution and empty `indexingEstimates`; a later rel_2_0_0 read was
  current. Verify whether work was still active when these states were captured
  or whether resolution and timing observed different readiness stages. Do not
  infer an estimate or remaining ETA from provisional resolution alone.

The existing provisional provenance footer still uses internal field labels.
Resolve the state semantics before redesigning that footer around preparation
status. This requires backend investigation outside this CLI lane; no backend
edits, extra polling or inferred timing were introduced.
