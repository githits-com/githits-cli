# M2b package source correspondence disclosure

Status: IMPLEMENTED; full client implementation review and draft PR/CI pending.
One coordinated client increment; no supported-surfaces-only milestone.

## Outcome and scope

CLI and MCP users receive the backend's exact package-source correspondence,
independently of index freshness, through read/list/search, legacy navigation,
unified grep and both CodeDiff sides. No binary-equivalence claim, second
resolver/provider call, schema probing/fallback, dependency or infrastructure.
No backend, aigrep or remote-mcp worktree is edited.

Initial client base was origin/main 2d18b7d. Shared work committed as 6854863;
merged current main 098f842 (#516 path advisories) into this feature branch as
a204222 without rewriting that commit. The PR delta is against current main and
does not absorb the already-merged path-advisory feature. Initial inspected
clients discarded the scalar and grep/diff lacked a backend contract. Those
historical gaps are now implemented here under the final user-supplied contract.

Backend M1/M2a is merged/dev verified per handoff (a0e996e, containing dev revision
9ba7ab2). New backend contract implementation is committed at ab1ca8fb6 on
jlitola/grep-diff-package-provenance, schema hash 21c66e6fb268, per user. It reports
187 focused tests, additive schema check and navigation/package traces passing,
internal code review clean; external implementation review is now clean (R1 plus fixture/docs-only R2), per user.
Backend plan's three-round external limit ended without a claimed clean external
round; all accepted findings were closed internally. Do not confuse that with
the separate local client plan review, which was clean in R3 after wording fixes.
Backend PR https://github.com/githits-com/pkgseer-backend/pull/3648 now has head
e2350f691, rebased onto main6217934d1 with runtime contract unchanged. User reports
210 focused tests, native GraphQL pagination, traces and additive schema check
passing; user reports CI40189938508 and all PR checks now GREEN, including
full suite, native integration, distributed rate-limit smokes, image and navigation.
External review is clean. Backend awaits user merge approval and is not merged/deployed. New grep/diff
deployment, including production support, is not verified.

## Ownership and implemented architecture

Backend owns assessment, selected identity and provenance locality. Core clients
own primary selection, Zod validation and normalization. Existing MCP shared
projection and presentation own CLI/MCP disclosure. Commands own output streams.

The optional nullable extensible scalar survives requested, resolved-requested
and served identities; explicit scalar null is retained wherever the identity is
emitted. State/locator come from served, or resolved-requested when serving is
absent. Registry/name come from the first backend identity carrying both;
version comes from the assessment-owning identity, never a different requested
or resolved version. Observed Guava served identities have null registry/name.
Unknown future strings remain in JSON without invented notice semantics.

Shared target-resolution notes delegate to one single-identity notice composer:
- manifest_matched: preserve state, no uncertainty notice or binary claim.
- tag_inferred: source inferred from version tag; manifest correspondence unconfirmed.
- unverified: source correspondence to package/version is unverified.
- declared_revision_unavailable: qualified release ref replaced an unavailable
  declared revision, across ecosystems.
- Ordinary null/omitted correspondence adds no notice.

The existing ref/SHA locator is used once per note. Pending identities say
resolved=; missing version omits the suffix and missing package context uses
generic requested-package wording. Source-provenance details and actual search
presentation append notes independently of CURRENT and completed-indexing
suppression. Freshness and terminal warning exits cannot hide the notice.
Search text deduplicates identical notes across lanes. Non-null state, including
manifest_matched/unknown strings, overrides healthy compact-JSON omission and
marks the entry interesting; null does not. Raw compact read stdout stays
byte-exact, with shared wrapped notices on stderr across unified exact-file,
unified selector and legacy read boundaries. Verbose/MCP reads use source details;
JSON stays structured. Unified list's minimal provenance selection includes
package context and the scalar; explicit silent output stays path-only.

## Final grep and CodeDiff contracts

GrepResult.targetResolutions: [GrepInputTargetResolution!]! is one ordered canonical
record per known original repository/package input. Fields: inputIndex:Int!,
target:String! (original label), targetResolution:TargetResolution!. Physical
statuses and omissions retain their original index links without another copy.
Site-only or unresolved-before-result inputs have no entry; pending-only success
has resolved-only/indexing entries. Prepared provenance survives UNSPECIFIED;
page readiness/traversal determines execution. No-hit failure clears serving in
the producer; the client never reconstructs it from labels or hit absence.

Core reuses the existing target-resolution schema/normalizer through the smallest
exports. Root array/record/resolution are required on wire. Optional DTO property
preserves verified older injected-provider compatibility, matching the existing
indexingEstimates precedent; no second network path is added. Compact mode
selects note identity fields; request/lifecycle/recovery/date details are guarded
by the existing includeDetailedFields directive for JSON. Shared text uses
selected= for prepared/unvisited source, served= only with linked repository
CURRENT/STALE readiness or repository-hit evidence, and resolved= if serving is
absent. Hosted readiness cannot establish repository execution. Reason/retry/
classification/cursor/path-advisory behavior is unchanged. Backend pre-execution
prose now says Selected indexed version rather than Serving indexed version;
client code neither parses nor rewrites it.

CodeDiffRefResolution.releaseCorrespondence:String is carried on both sides,
including partial error identity. Shared composition passes each side's resolved
version/ref/SHA/state to the same notice policy with from=/to= labels; no synthetic
TargetResolution or client Maven default. Backend supplies Maven unverified when
needed; ordinary non-Maven/raw nil remains nil. CLI notices use stderr in every
view without changing patch/path stdout; MCP uses the same wrapped notes; JSON
retains independent side values. Public types are additive/optional for injected
providers; changes fragment records pending minor impact for both artifacts.

## Acceptance and verification evidence

Distinct cases covered: three Maven states; NPM/PYPI declared-revision recovery;
nullable/unknown scalars; CURRENT and pending no-served; differing served SHA/
version and matched resolved vs unverified served; mixed inputs and shared native
scan; original per-input order; UNSPECIFIED/unvisited; searched zero hits; partial
hits; failure resolved-only; hosted vs repository execution; completed waited
search and compact healthy-contributor omission; read/list/search/grep/diff actual
CLI/MCP text/JSON parity and compact/verbose stream boundaries; error-map and
CodeDiff partial-error JSON; primary compact/detailed wire selections and no
additional calls. Two existing recorded grep pages gained only canonical
metadata using their original input/source facts, with ordinary npm/raw null.

Baseline shared test command (five files) passed 118 tests / 654 assertions.
Initial grep/diff six-file baseline passed 101 tests / 506 assertions. New RED
cases failed for missing wire/projection/notice behavior before implementation.
Final `bun test`: 6,740 passed, zero failed, 27,381 assertions across 259 files,
24.41s (/tmp/m2b-full-tests.log). `bun run build` and `bun run typecheck` passed.
Final lint/format, public packed-package validation, CLI unauthenticated smoke
and MCP registration/legacy-opt-in smoke all passed. Lint has 19 warnings in
unchanged repository-target.ts. Logs: /tmp/m2b-final-{lint,format,packages,smoke-cli,smoke-mcp}.log. Existing path-advisory suppression
comment was converted to an ordinary explanation because lint proved it unused;
no runtime advisory behavior changed.

Prior shared-path checks passed CLI unauthenticated and MCP registration smoke,
build/typecheck/lint/format/public package validation. Dev CLI/MCP search verified
Codec CURRENT/manifest_matched SHA1147e788058ee67509616903cbe2ddd149e02a04 and
Guava CURRENT/unverified SHA5c71d2a15435399fa62508d807d5cc83506f7496. Codec list
text/JSON and exact emitted raw-repository read passed. Guava list returned
SOURCE_INVENTORY_SCOPE_UNAVAILABLE; never count it as passing or expand this
increment into Maven inventory-scope repair. Mocked unverified list parity passes.
One simultaneous Codec auth failure succeeded on identical isolated retry; no
auth code or retry policy changed.

Agent eval: cleared inherited GitHits token/endpoint overrides, GITHITS_ENV=dev,
existing /Users/jpl/.codex-eval, `bun run agent:e2e --agent codex --server local
--surface mcp --guidance-profile descriptors --intent-profile githits --workload
eval/agentic/probes/package-source-correspondence.md --out
.agent-eval/package-source-correspondence --timeout 300`. Codex Luna high completed
five MCP calls (quick_start, two search, two read), final success/medium confidence,
explicit Guava uncertainty and no binary-equivalence claim. No isolation or
validation violations. Metrics: 28,996 uncached / 85,888 cached input, 942 output,
21.024s, harness base-rate estimate $0.00423. Neutral trace only, no graded quality
or performance claim. Grep/diff were not called; their live success is unverified
until backend deployment. No credentials or source bodies enter new diagnostics,
usage metadata or committed operational fixtures.

## Review, delivery and cleanup

Local plan R1/R2 fixes covered compact list context, raw read streams, production
rollout, observed null package context, state-owning version, all search omission
and warning gates, and non-null-only omission override. Local plan R3 was clean
with one fresh-context check after minor wording additions. Rejected the proposal
to omit manifest_matched JSON because the brief requires preserving returned
states; rejected pinning a legacy warning prefix as implementation detail. Null
omission correction supersedes the earlier broader all-scalars rule.

Shared slice internal code preflight was clean. Final slice B internal readiness
check was clean. Full client internal code_reviewer preflight found no actionable
findings on the complete current-main delta, using supplied validation without
rerunning checks. Full client external review now follows that serial internal pass
then fresh Claude Opus5.5 rounds, fixing/adjudicating findings to clean or the
three-round limit. Keep the external implementation reviewer through merge
approval. No implementation finding is deferred.

Before draft PR: update durable docs in search-snapshot-presentation.md,
unified-grep.md and code-diff.md; independent changes fragment; commit checked
implementation; full review. After clean review, move relevant evidence to those
durable docs and remove this local temporary plan in a final commit. Keep the
separate backend governing plan unchanged. Push/open ONE draft PR and observe
final-head CI; no supported-only delivery milestone.

Public release is explicitly held until the backend fields are deployed and
verified, including production, through normal authenticated operations. Existing
code-navigation compatibility queries stay unchanged and are not rollout.
Hosted MCP additionally requires approved @githits/mcp publication, remote-mcp
adoption and deployment. No merge, tag, release, publish or deploy authorization.
No new product/architecture decisions are open. Rollback removes additive client
projections/notices; coordinated schema removal is required after publication.


## External client implementation R1 closure

Direction sound; three low findings accepted. F1 -> unused requested.version in
compact grep -> inspected every compact notice consumer, requested name fallback,
all requested-identity fields and other source identity selections -> requested
version is now detailed-only; wire tests assert its directive and model compact
absence. Canonical input label/index remain required record identity; served and
resolved versions remain consumed by notes. Other grep JSON-only metadata already
has directives; list/read/search use their requested version in existing context.
F2 -> weak no-notice assertion only matched one Maven wording -> scanned new
no-notice tests across search/status, shared note helpers, grep and diff -> search
adapter negative assertion now covers all correspondence notice classes for npm
null and Maven matched across four adapters; grep sibling assertion strengthened.
F3 -> additive public API understated as patch -> checked actual optional exported
DTO/type additions and merged package-path-advisories precedent -> independent
fragment renamed .added.md with minor/minor. Highest pending release was already
minor, so this corrects the independent record without adding a second release.
No package versions or generated plugin manifests are changed in this feature PR.

Backend prerequisite #3648 will be explicit in client PR body. Publication stays
held for backend production deployment and verification. No other approval implied.
