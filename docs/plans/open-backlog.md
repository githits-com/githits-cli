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

## Upgrade review evidence completeness

The new aggregate `changelog.statements` contract exposes per-version coverage
membership and complete pages beyond the legacy risk-item cap. Client adoption
is documented in [upgrade review](../implementation/pkg-upgrade-review.md).

Structured supersession/revert relationships remain unavailable. That requires
backend API design, not client heuristics, and stays outside this migration.
Preserve the concrete requirements in the
[upgrade review limitations](../implementation/pkg-upgrade-review.md#other-evidence-and-fact-reporting-rules).
Consumer applicability remains the calling agent's job.

Concrete remaining case: Express 5.2.0 describes a security fix for
CVE-2024-51999; 5.2.1 says the prior change was erroneous, reverted, and the CVE
rejected. Separate versioned quotes are available, but no field links the earlier
claim to its correction. A reader must reconcile them manually; tier counts do
not describe the effective state at the target version.

Outcome: backend-provided supersession/revert relationships that retain the
original statements and cite the correcting statement's version/source evidence.
Acceptance: fixtures for that Express range expose the relationship with locators
and provenance; clients can display it without keyword-based guessing or a
package verdict. This needs backend/domain design and remains outside the
completed statement migration. Private-code applicability still requires local
usage inspection and before/after checks by the caller.
