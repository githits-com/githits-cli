# Source security evidence in package vulnerability reports

## Outcome and status

IN REVIEW: implemented one CLI/MCP increment, ending at a reviewed tested draft PR.
Explicit package vulnerability requests expose independent upstream Git evidence
alongside unchanged native findings, filters, counts, and optional OSV reports.
No merge, release, publication, deployment, or other repository edits are
authorized.

## Verified state and scope

- Core `package-intelligence-service.ts` owns GraphQL selection, decoding and
  pagination; MCP `package-vulnerabilities-response.ts` owns shared CLI/MCP JSON
  and text. These owners already serve every direct vulnerability consumer.
- `packageInfo` is used only for provenance and exact changelogs. No current
  explicit package-info security selector exists. Legacy summary security is
  implicit, so it must not start source preparation. Upgrade candidates and
  dependency inventories must not select source evidence.
- Read-only backend contract: branch `jlitola/repository-source-evidence-plan`,
  `priv/graphql/schema.graphql`, response schema 1.5.0 per handoff. Source scope
  UPSTREAM_GIT, six preparation states, independent counts/freshness and up to
  twenty original assertions with twelve selected fields each. Withdrawn rows
  remain provenance, never active findings. Unknown and affected can overlap.
- Full source selection costs 274: twenty admission points plus fourteen scalar
  fields plus twenty times twelve assertion fields. Backend maximum is 500.
  Existing native OSV detail selection requires smaller first-page pagination
  when combined with source evidence. Ordinary native pages remain 100 rows;
  later OSV report pages retain three rows.

## Architecture and assumptions

Core owns a typed source-security schema and GraphQL projection in a small
transport module, because this is backend evidence rather than presentation. The
existing service retains it as `security.source`; the lean JSON envelope exposes
the same nullable object as `upstreamSource`, without alias deduplication,
filtering, null stripping, recomputed counts, or truncation. Shared presentation
owns a source block with coverage, identity, uncertainty and assertion outcomes;
verbose output adds revision/check evidence. All selected fields have JSON
consumers. Native normalizers and counts remain unchanged; native and source
counts can overlap and must never be summed. When source evidence is present,
label native output as native package advisories so a native-zero headline
cannot contradict a source-positive result. Use the heading Upstream Git
evidence and state that native filters/scopes do not filter it. Keep existing
MCP annotations; internal preparation remains an implementation detail.

Source is selected only on the first vulnerability page, without a skipped field
declaration on later pages (admission charges declared selections). Use two
native OSV report rows on the combined first page (452 points). Compact first
pages cost 312; later compact/details pages cost 38/253. Subsequent pages retain
their existing size. No separate source request (the smaller first detail page
can add one advisory page), polling, provider call, fallback, cache, flag, queue
or caller constraint.

Assumptions: pending backend fields remain as the handoff describes; verify SDL
and exact generated query selection before completion. Backend is not deployed;
no live acquisition or paid evaluation is permitted. Unknowns/product decisions:
none for implementation. Backend schema deployment timing remains external.

## Phase 1 — expose and verify source evidence (IN REVIEW)

Dependencies: pending backend schema for later live verification and delivery.
Steps: add core types/schema/selection and first-page retention; add shared JSON
and text output; export public client types; add mocked transport, formatter and
actual CLI/MCP parity coverage; fix the Bun test exit-code restoration leak;
update implementation contract and release fragment. Public Agent Skill examples
are updated with release preparation, per the existing package report lifecycle.

Acceptance: - Cold, ready-empty, unknown, partial-positive, stale, truncated,
unsupported and   withdrawn evidence survives transport and JSON; all assertion
fields retained; missing or malformed selected source data fails   decoding,
explicit null remains null, and native-zero/source-positive text is unambiguous.
- Existing native advisory counts, scopes, filters, complete pagination, OSV
detail errors   and transitive behavior remain valid. Source findings never
become native fixes. - Wire tests assert exact per-mode fields and first:2/3/100
page sizes. A one-off   SDL validation with temporary tooling (no repository
dependency or vendored SDL)   records the schema hash and computed query costs
on the PR. Exact queries validate against the committed backend SDL and cost
<=500 in compact and   OSV-details first/subsequent modes. Other operations omit
source selection. - Focused tests, full `bun test`, typecheck, build and
unauthenticated CLI/MCP smoke   pass. Live dev smoke and agent e2e wait for
backend delivery: they would otherwise   fail schema validation and could cause
live acquisitions/paid analysis. - Internal preflight and one external Claude
reviewer converge cleanly; commit,   push and open draft PR with exact
validation evidence and backend delivery gate.

## Completion and cleanup

After clean final implementation review, move durable behavior and delivery
constraints into `docs/implementation/package-vulnerability-assessments.md` and
remove this single-increment plan before final push. Verification logs belong in
the PR, not implementation docs. Hosted MCP later needs an independently
approved package release, remote dependency update and deployment outside this
worktree.
