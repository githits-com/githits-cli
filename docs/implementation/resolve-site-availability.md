# Resolver readiness and on-demand search

`docsAvailable: false` is current readiness, not a prohibition on search.
GitHits displays `documentation not currently ready` on SITE rows, regardless
of whether page counts are absent, zero or positive. Package/repository evidence
and the JSON projection retain their existing behavior.

The shared evidence formatter owns this label because both CLI and MCP renderers
consume it. The backend owns identity ranking, confidence, candidate order,
readiness, admission and preparation. No new state, requests or client ranking
are introduced.

A non-ambiguous EXACT/HIGH best with a matching full target and safe
CLEAR/NOT_APPLICABLE security status keeps its normal search continuation,
including a site with false docs availability. MEDIUM/LOW and ambiguous results
retain their existing choice/narrowing rules. Missing full-best or unsafe/missing
security evidence remains fail-closed. Readiness does not override security.
A related product is never substituted for the selected identity.

Search of package-referenced or otherwise admitted sites remains the ordinary
entry point for backend crawl/preparation. Resolver output does not claim that
work is queued, preparing, or due at a particular time. Only the actual search
response may establish indexing/preparation state. Readable stale site docs stay
usable; the client does not infer freshness from page counts.

## Delivery and evidence

This is corrected S2b, governed by the user's 2026-09-07 instruction withdrawing
the original availability guard. Baseline: refreshed main
`d48415792499f61b3203e700267a21617269419c`. The initial uncommitted guard and
its guard-specific tests/docs were removed before any commit or PR.

One Luna implementor completed the superseded actionability-test slice, then
its next dispatch failed due to a provider usage limit before edits. The owning
coordinator explicitly took back the remaining work and implemented the revised
readiness label, fixtures and documentation inline. Both sessions shared this
worktree under danger-full-access; no worker isolation is claimed.

Named `S2b readiness` tests cover shared actionability/evidence, CLI/MCP text and
JSON parity in compact/verbose modes, the compact/detailed service payload, and
ordinary search continuation. The fixture retains best `site:ai.pydantic.dev`,
EXACT confidence, safe NOT_APPLICABLE status, false docs availability, positive
retained pages and ordered related alternatives. Additional cases cover absent
and zero counts, singleton HIGH, all-unready ambiguity, unknown empty results,
MEDIUM/LOW, readable stale docs, actual security warnings and missing full best.

The search tests invoke each existing adapter with the same selected site, plus
a package control. They prove one ordinary DOCS search request, no readiness
filter or substitution, and indexing text only after an INDEXING response.
These deterministic client fixtures do not prove actual backend admission,
crawl execution, publication recovery, or live agent behavior.

No client-first guard dependency or mandatory client-upgrade requirement remains.
Backend S2a retrieval work is independent and outside this lane. The backend
source plan is read-only here; its owner must replace superseded guard clauses
and record this delivery. No corpus mutation, merge, release or deployment is
part of this PR. The pending patch fragment records wording impact for both
public packages; old clients already preserve ordinary search continuation.

Verification on the corrected delta:

| Exact command | Evidence |
| --- | --- |
| `bun test packages/mcp/src/shared/resolve-target-response.test.ts --test-name-pattern 'S2b readiness'` | 7 named cases: EXACT/HIGH continuation; absent/zero/12-page labels; security fail-closed; package/repository controls |
| `bun test src/tools/resolve-target-parity.test.ts --test-name-pattern 'S2b readiness'` | 22 named cases: 11 scenarios each in compact/verbose text and JSON, including best/order preservation and actual security warnings |
| `bun test packages/core-internal/src/services/resolve-target-service.test.ts --test-name-pattern 'S2b readiness'` | 2 named compact/detailed cases retain best, false readiness, positive count, safe status, alternatives and one unchanged query |
| `bun test src/tools/search-parity.test.ts --test-name-pattern 'S2b readiness'` | 4 named CLI/MCP site/package cases send one ordinary DOCS search request and display indexing only after the response |
| `bun test packages/mcp/src/shared/resolve-target-response.test.ts packages/mcp/src/tools/resolve-target.test.ts src/commands/resolve.test.ts src/tools/resolve-target-parity.test.ts packages/core-internal/src/services/resolve-target-service.test.ts src/tools/search-parity.test.ts src/commands/search.test.ts packages/mcp/src/tools/search.test.ts` | 240 pass, 0 fail |
| `bun test` | 4,188 pass, 0 fail |
| `bun run typecheck` | Pass after correcting the service test's required limit; both affected parser cases rerun successfully |
| `bun run lint` / `bun run format:check` | Pass |
| `bun run build` | Pass |
| `bun run smoke:cli --mode unauthenticated` | Pass; secret-free CLI auth/registration coverage |
| `bun run smoke:mcp --mode registration` | Pass; secret-free stable/experimental MCP registration and auth coverage |
| `bun run plugins:check` | 10 assets validated |

The complete suite preceded the test-only `limit: 8` correction; typecheck and
the two affected service cases passed afterward. No production behavior changed
after that suite. Live agent evals were not run: this increment's acceptance is
deterministic and the existing harness has no reviewed unready-site fixture
mode. Production smoke and actual backend preparation remain unclaimed.

Review disposition: one Fable plan review accepted three minor clarifications
(absent counts, SITE-only label, and existing search-fixture location). One Luna
preflight confirmed conformance and client acceptance. Its request to remove the
baseline SHA was rejected on 2026-09-07: the SHA is intentional verification
provenance, not a runtime contract. Do not re-raise without new evidence.
The coordinator reviewed the complete delta inline under the repository's
single-file/small-runtime reviewer-sizing rule; no internal reviewer subagent or
nested reviewer was needed. External Opus round 1 found no runtime issues.
Accepted and fixed its documentation findings: the standalone-site section no
longer assumes docs availability, the edited paragraph is wrapped, and the
completed temporary plan is retired. A bounded scan of the changed resolver docs
found no other always-available assumption. Positive retained page counts do not
prove readability; readable stale docs have `docsAvailable: true`.
The external closure review follows these documentation-only corrections.
