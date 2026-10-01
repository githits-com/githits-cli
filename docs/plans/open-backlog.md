# Open backlog

## Optimize overall tool routing and investigation instructions

User deferred this follow-up until after unified MCP grep adoption on
2026-10-01. Scope is overall search/grep/read strategy, not an unfinished
unified-grep implementation.

Evidence: [PR #439 Braintrust run](https://github.com/githits-com/githits-cli/actions/runs/36717422684)
had seven successful grep calls with reusable read locators. Source investigation
still made avoidable reads before locating usages, and mixed-docs runs added
site scopes despite package-selected hosted docs already being included. Adding
an explicit site extends coverage; it does not narrow existing package docs.
The durable comparison is in
[agentic-eval-metrics.md](../implementation/agentic-eval-metrics.md#unified-mcp-grep-versus-release-0240--2026-09-30).

Outcome: make the normal investigation route accurate and efficient. Verify
whether search or grep gives better evidence for identifier usages before
prescribing either universally; the attempted paired Express CLI comparison
produced no results because both processes timed out on the local auth storage
lock. Do not treat that as tool performance or result-quality evidence.

Ownership: tool descriptions own selection and scope semantics; the shared
routing guide owns cross-tool strategy. Keep its public MCP skill copy aligned.

Acceptance: compare the same pinned Express identifier task through search and
grep, inspect the actual usage evidence and output size, then evaluate the
source-grep and mixed-docs workloads under intent and full guidance against the
recorded four-cell baseline. Preserve exact locators, truthful coverage and
version attribution, and avoid an unnecessary prerequisite search/read step.
Single-run token changes and self-reported confidence are not quality scores.
