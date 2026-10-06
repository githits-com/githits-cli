# Open backlog

## Unify search and grep headers and footers

User selected this as a follow-up after merging
[PR #454](https://github.com/githits-com/githits-cli/pull/454) on 2026-10-06.
The merged Sources/Preparing boundary remains the foundation. This is a bounded
presentation increment, separate from tool routing and investigation guidance.

Evidence: authenticated dev CLI and local MCP captures returned usable Express
documentation while repository code indexed. Search's header was
`1 partial result | 1 docs page | indexing | 0/1 ready | next_offset=1`;
grep's was `1 match in 1 line across 1 page; more available`.
Search's unqualified readiness count is ambiguous beside usable docs results,
and pagination notation competes with the outcome. Footer wording and anatomy
also differ (`Next: use these hits now` versus `# Read pages` and
`More matches: repeat this grep, adding:`); grep's long opaque cursor dominates
its continuation. Indexed-alternative summaries use both `+7` and `(+5 more)`.
The permanent capture context is in
[search-snapshot-presentation.md](../implementation/search-snapshot-presentation.md#shared-sourcepreparation-boundary-2026-10-06).

Outcome: give search and grep a common outcome-first header and footer anatomy:
returned evidence, Sources/Preparing, results, then read, pagination and optional
wait/retry guidance. Retain each tool's meaningful counts and semantics rather
than forcing identical result labels. Make readiness scope explicit and evaluate
moving pagination mechanics out of the outcome headline. Reuse common wording
where the facts and actions are equivalent, including alternative-summary
notation when using shared preparation copy.

Ownership: the existing shared CLI/MCP tool formatters own placement and native
actions; shared presentation helpers own genuinely repeated wording. Establish
the concrete output shape before deciding whether another helper is warranted.
Core services do not own display copy. No backend/schema work, new output mode,
flag, layout framework or change to JSON is implied.

Acceptance: compare actual CLI and MCP search/grep output for ready results,
ready docs with pending code, multiple targets with mixed readiness, empty
results and continuation pages. A reader must distinguish usable results from
preparing scopes without decoding `0/1 ready`. Both tools should order read,
more-results and wait/retry actions consistently, with exact backend operands,
opaque cursors and existing wait units preserved. Investigate a less intrusive
cursor layout without truncating it or inventing a replacement. Verify narrow
and normal widths, ANSI-free parity, truthful coverage and retained indexing
alternatives. Broader read/list output changes require separately verified scope.

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
