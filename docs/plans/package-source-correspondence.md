# M2b package source correspondence disclosure

Status: SHARED IMPLEMENTATION VERIFIED; full delivery awaits reviewed backend grep/diff contracts.

## Outcome and verified baseline

Agents and CLI users see the backend's source correspondence for the actual
served package source, independently of index freshness. This is the bounded
client successor to backend Maven M1/M2a in RELEASE_REPOSITORY_SELECTION.md;
that cross-repository plan remains owned by its existing lane.

Base: origin/main 2d18b7d (2026-10-25); branch HEAD at the same revision.
Working-tree implementation began after R1 corrections.
Backend handoff reports M2a merged at a0e996e and dev verified at 9ba7ab2.
The backend plan's older pending status is superseded by that handoff evidence.
Current client identity selections, Zod parsing, normalisation and lean
projection omit releaseCorrespondence. Two shared text paths suppress CURRENT:
target-resolution.ts notes and source-provenance-text.ts details. Actual search
text uses unified-search-presentation/text, not the legacy note string alone.
Unified list has its own nullable identity projection and minimal text selection.

Audited backend schema: code_target_identity exposes the nullable string;
GrepTargetStatus and CodeDiffRefResolution do not expose it or targetResolution.
Unified grep and diff therefore cannot disclose it within a client-only change.
No second resolver call, inferred confidence, schema probing or query fallback
will be introduced. User decided FULL support in one coordinated client delivery.
The backend lane is planning and implementing additive grep/diff provenance;
wait for its reviewed field names before wiring those surfaces.
Legacy code grep and package navigation do use the common target resolution.

## Ownership, scope and assumptions

The backend owns correspondence assessment, source selection and identity-local
provenance. Core service clients own selection/validation/normalisation. Existing
MCP shared projection and presentation helpers own CLI/MCP disclosure; neither
command handlers nor individual tools should implement warning policy.
A pure correspondence-note helper belongs beside target-resolution notes and
accepts the nullable structural identity shared by list/source presentation.
This is simpler than per-tool notices or a new service/module. Source presentation
and actual search text call that helper; freshness suppression stays separate.

Preserve the nullable extensible string without mapping unknown values or
borrowing a resolved assessment for a served identity. Select it on requested,
resolvedRequested and served; the requested scalar is normally null. Preserve explicit scalar
null versus omission; leave existing normalization of unrelated null fields intact. Text uses served if present, otherwise resolvedRequested,
and labels the latter resolved. State and locator come solely from that identity. Package registry/name come
from the first of served, resolvedRequested, requested carrying both fields;
the version comes from the state-owning identity, never a different resolved
SHA/version. Dev Guava served identities have null registry/packageName and
carry version/ref/SHA/state, so cover that observed shape. No label parsing or
binary-equivalence claim.

Assumptions verified by current code/schema: existing shared selections cover
read, legacy files/grep, package navigation, search source status and progress;
unified list needs its distinct projection updated. Every provenance-bearing text mode needs the
scalar, so no mode-specific scalar exclusion. Existing detailed-only list fields
and silent-output behavior remain intact. Promote registry, packageName and version
on resolved/served identities into minimal list provenance so compact text names
the selected package version without parsing labels or borrowing requested state. Unknown future strings remain in JSON
without fabricated notice semantics. No open notice-policy product decisions.

## One coordinated delivery, two implementation slices

Slice A status: IMPLEMENTED — independent shared projections/notices and existing identity consumers; internal code preflight clean.
Slice B status: WAITING — unified grep/diff contracts from backend plan review.
No supported-surfaces-only PR or release milestone. Both slices share the full
M2 acceptance and one final reviewed draft PR/CI gate.
Dependencies: additive identity field deployed on dev (handoff verified); existing service
DI and shared formatter paths. No new runtime dependency/infrastructure.
Expected outcome: all package-source surfaces, including unified grep and CodeDiff, retain exact correspondence
in compact/verbose/JSON output, including current and completed waited search.

1. Add wire/projection and shared-notice regression tests, then implement the
   scalar through code-navigation and unified-list clients. Preserve ordinary
   null and absent identities, unknown strings and independent states/SHAs.
2. Share state-specific notes for tag_inferred, unverified and
   declared_revision_unavailable; manifest_matched and ordinary null/omitted
   add no notice. Keep one notice per affected target through source/target
   deduplication. Retain existing ref/SHA locator grammar. Do not restore obsolete
   stale/indexing retry hints on CURRENT/completed output.
3. Test actual CLI/MCP adapters for Maven states, npm and one other adopted
   ecosystem's recovery state, pending resolved-only, different served SHA,
   mixed targets, compact/verbose/JSON and waited completion. Extend small
   fixtures instead of copying an operational inventory. Audit direct shared
   navigation/legacy consumers and JSON omission gates.
4. On receipt of reviewed backend contract, reorient slice B against its exact
   GraphQL fields and semantics; add wire/parser/projection/text/JSON/parity
   coverage for unified grep and each CodeDiff side. Reuse the common note
   policy without manufacturing a TargetResolution if the contract is simpler.
   Field names, per-side semantics, pending states and deployment readiness are
   explicitly unknown until that handoff; do not select guessed fields.
   Update docs/implementation/search-snapshot-presentation.md and an independent patch fragment
   for githits and @githits/mcp after both slices are complete.
4a. Raw CLI read output remains byte-exact: compact uncertainty notices go to
    stderr in unified and legacy read command paths, using the same shared note
    builder. Wire all three boundaries: unified exact-file read, unified
    selector read through formatReadResult, and legacy pkgReadAction.
    Verbose and MCP reads render notes with existing provenance details.
    Explicit silent list retains path-only behavior and its existing no-provenance
    selection. Add command assertions for these deliberate stream boundaries.
5. Verify, commit, run serial internal and Claude implementation review to a
   clean round or its three-round limit, then retire this temporary local plan
   in a final commit after transferring durable evidence. Push a draft PR and
   observe final-head CI. Retain the Claude code reviewer until merge approval.

Acceptance: exact scalar survives all three identities; matched resolved cannot
hide unverified served. Pending notes say resolved. Maven three-state notices
and cross-ecosystem recovery follow backend states rather than freshness or
labels. CURRENT suppresses obsolete retries but never correspondence notices.
Actual initial/status/waited search and JSON/text paths agree. Shared list/read/
legacy grep/navigation do not lose the scalar. Unified grep and CodeDiff disclose
actual source assessments under their reviewed additive contracts. No extra
network/provider call. Full acceptance remains required before PR delivery.

Notice templates (one per affected target):
- tag_inferred: Source for <package>@<version> inferred from version tag;
  manifest correspondence unconfirmed; served=<existing ref/SHA locator>.
- unverified: Source correspondence to <package>@<version> is unverified;
  served=<existing ref/SHA locator>.
- declared_revision_unavailable: Source for <package>@<version> uses a qualified
  release ref because the declared revision is unavailable; served=<locator>.
Use resolved= for pending identities. Keep existing locator grammar. If the
state owner lacks a version, omit the @version suffix; if no identity carries
registry/name, use generic wording referring to the requested package and retain the known locator.

Search omission/suppression gates explicitly covered: target-resolution CURRENT;
source-provenance renderResolutionDetails and its requested/indexing helpers;
actual unified-search-text provenance facts; completed+indexing early return in
targetResolutionWarningForEntry; compactSourceStatusEntry healthy-contributor
omission. Preserve every returned non-null scalar in JSON, including CURRENT
manifest_matched and unknown values, despite old healthy-omission rules.
Ordinary null/omitted scalars do not override healthy-contributor omission;
when an identity is emitted its scalar null remains exact. Also append notices
independently of warningForEntry freshness and terminal-lifecycle early exits.
Completed+indexing+unverified must retain correspondence without stale retry
hints. Add observed null-package served shape and different served version cases.

## Review and verification evidence

Initial internal plan preflight: direction sound; accepted compact-list identity
selection and compact-read stderr findings. Both are normal-input disclosure
gaps with small local fixes; they require no infrastructure. Scalar null wording
clarified without changing unrelated normalization. Bounded scan checked both
unified and legacy read commands and the complete list selection/projection.
Baseline command: bun test packages/mcp/src/shared/target-resolution.test.ts
packages/mcp/src/shared/source-provenance-text.test.ts
packages/core-internal/src/services/read-service.test.ts
packages/core-internal/src/services/list-service.test.ts src/tools/search-parity.test.ts
Result: 118 passed, zero failed, 654 assertions (604 ms).

## Verification and operational constraints

Focused bun tests: core code-navigation/read/list service wire tests; shared
target-resolution/source-provenance/list response and text tests; actual
read/list/search adapter/parity suites and directly affected legacy consumers.
Run bun run typecheck, lint, format:check, build; required smoke:cli and smoke:mcp
with cleared inherited token/endpoint overrides and GITHITS_ENV=dev when auth
is available. Exercise dev Codec manifest_matched and Guava unverified text/JSON.
Run a targeted agent:e2e workload for source disclosure and inspect trace,
final answer, metrics and isolation; report neutral evidence, not quality claims.
No performance optimization/benchmark claim; only additive scalar and pure notes.
No source bodies or credentials enter diagnostics or usage metadata. Existing
errors/auth and DI remain unchanged. No migration, probing or new fallback.
Rollback is the ordinary code/package rollback, losing disclosure only.

Hosted remote MCP adoption still requires approved @githits/mcp publication,
remote-mcp dependency adoption and deployment. This increment authorizes none of
merge, release, tag, publication or deployment. No edits outside this repository.


External plan R1 adjudication: direction sound. Accepted dev-only deployment
qualification and production rollout gate; ordinary release order can otherwise
break strict read/list queries, but draft-PR work is safe. Accepted observed
Guava package-label shape and state-owning version, explicit omission gates,
notice grammar, three stderr boundaries and durable-doc naming. Rejected the
suggestion to omit healthy manifest_matched JSON: the brief explicitly requires
preserving the field through lossy projections. No product choice remains.
Closure scan: shared primary query and existing compatibility builder, unified
read/list service selections, source-status compaction/warning gates, actual
search presentation, both CLI read modules and nullable list projection.

Before any future coordinated release/publication, verify production supports
releaseCorrespondence and the reviewed grep/diff fields with authenticated
normal operations. No release/deploy is authorized here. Existing code-navigation
compatibility fallbacks stay unchanged and are not a rollout strategy; strict
read/list have no scalar fallback. Primary-wire regression tests require direct
field selection. Hosted MCP has the same backend-before-client ordering.


External plan R2 adjudication: accepted null-scalar healthy-omission correction
(normal non-Maven responses otherwise gain redundant identity blocks), independent
warningForEntry freshness/terminal exit handling, and requested-scalar wording.
Closure scan covers every scalar-presence gate, primary/lean/list null handling,
warningForEntry and targetResolutionWarningForEntry, completed/current handling,
and actual search text. Add null healthy-contributor compact JSON and divergent
STALE+unverified warnings tests. R2 reviewed the plan against HEAD only; shared
implementation began after R1 corrections while R2 was running. No claim that
R2 reviewed the uncommitted production delta. Full implementation review follows
both slices, under the separate code-review scope.


External plan R3: clean after minor plan-text additions, including the single
fresh-context final check. Accepted explicit compactSourceStatusEntry final
interesting/includeHealthy gate: any non-null assessment must attach resolution
and mark the entry interesting, regardless of contributors or completed-indexing.
Null never does. Deduplication uses the full notice built from the state-owning
package/version and existing ref/SHA locator; two sources for the same target
produce one notice, distinct source identities remain distinct. Add an error-map
JSON preservation assertion. Rejected pinning a legacy warning prefix as needless
implementation detail. No further plan round required. Slice B and final full
implementation review remain pending; no supported-only delivery milestone.


Slice A implementation evidence (2026-10-25): 443 tests / 2335 assertions passed
across 11 focused service/projection/formatter/adapter files; typecheck, lint and
build passed. Lint's 19 warnings are all in unchanged repository-target.ts.
CLI unauthenticated and MCP registration/legacy-opt-in smokes passed via
bun run smoke:cli --mode unauthenticated and bun run smoke:mcp --mode registration.
Dev CLI Codec CURRENT/manifest_matched preserves SHA1147e788058ee67509616903cbe2ddd149e02a04;
Guava CURRENT/unverified preserves SHA5c71d2a15435399fa62508d807d5cc83506f7496.
One simultaneous Codec request returned AUTH_REQUIRED; identical isolated retry
passed. No auth code or retry policy changed. Targeted live MCP verifies Codec
search/list text+JSON (no notice), exact emitted repository read (ordinary null),
and Guava search text+JSON (unverified notice, wrapped prose). Guava list returned
SOURCE_INVENTORY_SCOPE_UNAVAILABLE: backend package inventory scope is unavailable
for this snapshot. This is the separate Maven/package-scope work, not a lost
client scalar; no successful live Guava-list claim is made. Mocked unverified
list text/JSON/parity remains covered. No backend or PR #516 scope is absorbed.
Full M2b agent eval and final full-delta review/PR/CI wait for slice B adoption.
Internal slice A code preflight found no actionable findings and ran no duplicate
validation. Logs are local /tmp/m2b-* receipts, not committed source-body fixtures.


Final slice A check: 715 tests / 3237 assertions passed across 18 existing and
new focused service, formatter and adapter test files. Typecheck, whole-repo
format check and git diff --check passed. Build and lint evidence above still
applies (no production change since build). The final added assertions cover
null healthy-contributor omission, no-retry CURRENT matched JSON, completed
indexing JSON, STALE-divergent warnings and error-map JSON scalar preservation.
Agent eval, final full implementation review, draft PR and CI remain one full
M2b delivery after reviewed backend grep/CodeDiff contract and client adoption.
