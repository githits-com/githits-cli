# Open backlog

## Authenticated smoke recovery fixture — 2026-10-24

During [PR #516](https://github.com/githits-com/githits-cli/pull/516), both full
authenticated smoke suites stopped before grep: the recovery probe expects
`go:github.com/docker/docker@v20.10.0` to fail, but dev now resolves it as
`v20.10.0+incompatible`. A nonexistent version returned `VERSION_NOT_FOUND`
without alternatives, so it cannot simply replace the existing probe, which
also checks backend-supplied recovery guidance. Unauthenticated smoke and the
affected built CLI/MCP grep qualification passed independently.

Ownership: the CLI/MCP smoke cohorts own the fixture and assertions; backend
recovery metadata owns the supplied alternatives. Investigate that boundary
before choosing a replacement fixture or correcting a verified producer issue.
Keep the assertions for error code, alternatives and native CLI/MCP recovery
syntax; do not turn the probe into a successful lookup or weaken coverage.
Acceptance: both authenticated dev smoke suites pass with a verified failing
version/ref and supplied alternatives, and continue through their live cohorts.

## Literal path round-trips — 2026-10-22

The path audit reproduced two accepted-input inconsistencies beyond ordinary
package/repository root selection:

- `list` actions and backend `PathContract.validate_exact` preserve literal
  filename bytes, but `resolveReadLocator`, `buildReadFileParams`,
  `ReadService.normaliseReadRequest`, and legacy CLI builders trim surrounding
  whitespace. A returned `src/file.ts ` path is therefore read as `src/file.ts`.
  Existing unit tests explicitly require trimming; correcting this needs a
  coordinated read-input contract change, not an isolated formatter patch.
- CLI `parsePathWithOptionalRange` interprets every numeric `:line` suffix as
  shorthand. An emitted action for literal `src/example:12` is read as
  `src/example` at line 12; an emitted explicit range then causes a range-form
  conflict. Shell quoting does not resolve argument-parser ambiguity. MCP
  treats the same path literally. Selecting an unambiguous literal-path CLI
  form is a product/input-grammar decision.

Ownership: backend scope helpers retain authoritative coordinates; shared read
input normalization and CLI argument parsing own these two inconsistencies.
Do not infer or strip package directories in the client to address either one.
Acceptance: replay the exact paths from list/search/grep actions through CLI
and MCP, including leading/trailing spaces, literal numeric-colon filenames,
normal line shorthand, and explicit ranges; assert the backend receives the
same target/path pair. Keep blank optional argument behavior intentional.

## Validation error recovery after PkgSeer phases 3-4

Deferred from the completed version/ref recovery work in PR #485. Start after
PkgSeer public-error-catalog phases 3-4 ship and their actual validation shapes
are verified. The current client behavior is documented in
[version and ref error recovery](../implementation/version-ref-error-recovery.md).

Outcome: consume structured `VALIDATION_ERROR` facts, including `input_path` and
`reason`, and give CLI users and MCP callers recovery guidance in their own flag
or argument names. Preserve complete decoded facts in JSON and pass backend
prose through for unknown reasons or incomplete shapes; do not scrape messages.

Ownership: core services decode the backend contract; shared presentation and
CLI/MCP boundaries own user wording and native syntax.

Acceptance: verify the shipped producer contract and real responses, then add
parser, formatter and actual-surface tests for known reasons, malformed/missing
fields, unknown reasons, CLI/MCP JSON preservation and native guidance. Run the
affected CLI/MCP smoke suites and targeted agent evals. Grep `target_issues` and
indexing recovery remain separate contracts.

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


## Cargo alias rollout and hosted adoption — 2026-10-19

Client implementation accepts `cargo:` / `cargo` as crates.io aliases; canonical
identity stays `crates` / `CRATES`. See
[registry input aliases](../implementation/package-registry-aliases.md).

Authenticated dev verification on 2026-10-19 distinguishes two endpoints and
their observed acceptance over time:

- Parallel AKS, `https://oss-aks-dev.githits.dev`, passes alias/canonical identity,
  package metadata and forwarded inventory/read/grep (separate authenticated backend evidence).
  Current built CLI and local MCP also passed 20 paired metadata/search/list/read/
  grep calls using the existing dev credential profile. Metadata/search/read JSON
  matched exactly; list differed only in requestedTarget, grep only in two raw
  target labels. All five payloads matched CLI/MCP for each spelling.
- Canonical dev, `https://oss-dev.githits.dev`, initially passed `crates` but
  rejected raw `cargo` with `VALIDATION_ERROR` / invalid_format in separate
  authenticated backend checks. A later same-day backend identity refresh passed
  both spellings. At 09:48 UTC, current-built CLI and local MCP then passed all
  20 paired metadata/search/list/read/grep calls and four missing-version calls
  on default dev services. Metadata/search/read matched exactly; list differed
  only in requestedTarget, grep only in two raw target labels. All five payloads
  matched CLI/MCP for each spelling, and identity/evidence fields matched the
  preserved AKS run. Missing-version errors and canonical retry actions matched
  per surface. This records earlier rejection and current acceptance; no DNS,
  routing or deployment mechanism is inferred. No deployment or routing change
  was made by this client task. Neither endpoint proves production or published/
  hosted-client availability.

Client source evidence was pinned to `serde@1.0.228`, served SHA
`a866b336f14aa57a07f0d0be9f8762746e64ecb4`: search had five code hits and hasMore;
inventory was CURRENT with three entries; Cargo.toml lines 1–12 matched (SHA256
`2310fd8f3fe22938fa967d07ce5434378cea7d439e7eaf2525a78a99a994e4a2`). Grep was a
bounded RESUMABLE_LIMIT page: three repository and two hosted-doc hits, no
unavailable targets in the client run. The earlier direct backend run had five
repository hits while selected docs were documentation_publishing. Neither page
is exhaustive. Latest-only metadata returned serde 1.0.229. After the recovery-only client fix,
a further four paired missing-version CLI/MCP calls returned equal per-surface
VERSION_NOT_FOUND payloads and canonical crates:serde@1.0.229 retry actions.

The original AKS run used process-local `GITHITS_ENV=dev` plus
`GITHITS_CODE_NAV_URL=https://oss-aks-dev.githits.dev`; other service/token overrides
were cleared. The later default-dev run used only `GITHITS_ENV=dev`, with every
service URL, token and auth-storage override cleared, including
`GITHITS_CODE_NAV_URL`. Both used the current Node-built CLI/local stdio MCP with
normal dev keychain credentials and refresh; no tokens were printed, copied or
handled manually. The default-dev run used client code at `5907c2b` (docs HEAD
`aadbc1a`); its captures were saved separately from the original AKS evidence.
Earlier file-storage source smokes had AUTH_REQUIRED and remain auth-only evidence;
the neutral targeted eval made zero GitHits calls and remains separate evidence.

After separately authorized publication and a full handoff, reorient the hosted
repository on current main, released artifact version and consumer lockfile. Use
its existing dependency-bump workflow; update manifest/lockfile without copying
package-owned alias logic. Acceptance: intended artifact resolves, consumer checks
pass and, after separate deployment approval, authenticated paired metadata/search
and forwarded list/read/grep verify alias parity against the intended deployed
backend. Revert the dependency for rollback; roll back forwarding clients before
removing backend admission. Exact artifact and future deployed state remain
unknown. No merge, release, publication, deployment or other repository edit is
authorized by this client handoff.
