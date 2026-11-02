# Replayable resolver targets and live recovery smoke

Status: IMPLEMENTING; internal plan review clean, external plan review clean
after three minor wording/coverage additions. One phase. Product decisions:
none. This is a follow-up within CLI PR 528; no merge/release/deploy authorized.

## Problem and expected outcome

Direct Googlesource HTTPS support works, but resolve exposes canonical identity
as an executable target. Production already returns the correct separate
`searchTarget`. CLI/MCP must emit it for follow-up use while retaining identity
for matching, grouping and trust. Full live smoke must also reach its remaining
cohorts instead of failing on a valid Docker version.

## Verified contract and ownership

- Backend PR 3818 is merged. A read-only production GraphQL request for
  golang.org/x/time returned repository canonicalKey
  `googlesource:go.googlesource.com/time` and searchTarget
  `https://go.googlesource.com/time`. CLI query/schema/types currently omit
  searchTarget; the shared presenter uses canonicalKey as its output address.
- The existing core resolve service owns fetching/decoding these fields. The
  existing shared presenter owns executable addresses and JSON projection;
  canonicalKey continues to own joins, deduplication, best-match/security lookup
  and grouping. No provider inference, prefix alias or new formatter is needed.
- Both compact and detailed resolve modes, including best/protected references,
  need searchTarget. The optional name-similarity evidence query uses identity
  only and must not fetch an unused searchTarget.
- Docker v20.10.0 now resolves as v20.10.0+incompatible. A verified probe on dev
  and prod, npm:express@99.99.99, returns VERSION_NOT_FOUND, a nonempty
  availablePackageVersions array, and a native retry action. CLI/MCP live smoke
  already asserts all three and should retain those assertions.

Assumptions: backend searchTarget is the authoritative public replay address
(verified deployed GraphQL field and merged schema String! declarations on
both TargetResolutionCandidate and TargetResolutionTarget); no absent-field
compatibility fallback is needed. Unknowns: none for this implementation.
Dependencies: existing dev/prod auth and deployed searchTarget field. Separate
backend agent owns provider/HTTPS-fragment diagnosis and edits no CLI files.

## Scope and phase 1

Expected outcome: resolve output can feed Googlesource HTTPS search/list/read;
site descendants are preserved as supplied; existing package/provider results,
ranking/confidence, malicious-content gates and identity grouping remain intact.
Status: IMPLEMENTED; verification/review in progress.
Assumptions/unknowns/dependencies: above.

1. Require searchTarget in service reference/target interfaces, response schemas
   and normalizers. Fetch it once in the existing reference/list fragments for
   both output modes; keep detailed-only selections and similarity fields intact.
2. Emit searchTarget in candidate target, best/protected target strings, terminal
   candidate headings and executable next commands, including the existing MCP
   text renderer in packages/mcp/src/tools/resolve-target.ts. Keep canonicalKey for all
   identity/security/grouping operations. Reword MCP "canonical target" continuation
   copy as the supplied target; update CLI docs and wire-selection contracts. Preserve canonical identity in JSON as
   an additive canonicalKey field only when it differs from emitted target, so
   existing identical-address payloads remain compact and unchanged.
3. Add focused wire/normalization, presenter and CLI/MCP parity regressions for
   distinct Googlesource keys and scoped site addresses, including best/protected
   references and blocked/ambiguous outcomes. Update only affected existing mocks
   for the now-required backend field. No new test harness or dependency. Update the existing outside-workspace
   package-validator mock to supply the same required field.
4. Replace Docker smoke coordinates with the verified invalid Express version in
   both CLI and MCP probes and their Docker-keyed unit fixtures; retain error,
   alternatives and native-action checks. Update the existing
   eval/agentic/probes/version-ref-recovery.md workload to the same coordinate.
   Remove the closed Docker backlog item after live verification succeeds.
5. Correct durable resolve/repository contracts, the misleading rollout fragment,
   and the prior PR verification diagnosis. Remove this PR's execution-log section
   from implementation docs; execution evidence belongs on PR 528. Add a separate
   resolver-fix release fragment (patch both artifacts); no version bump.
6. Verify focused service/presenter/parity/smoke-contract tests, typecheck, full
   unit suite, build, package validation and source/built CLI/MCP smoke. Run dev
   authenticated suites through the complete cohorts; run production qualified
   resolve-to-search/read replay and full live smoke as authorized by Juha. Do not
   weaken assertions if a later failure appears; diagnose and fix minor verified
   client issues. Escalate actual major scope or product decisions.
7. Run the existing targeted descriptor-only navigation/resolve agent eval for
   changed MCP behavior, inspect raw calls/final/metrics/isolation evidence.
8. Internal preflight and the retained external Claude code reviewer to clean,
   commit, update PR, delete this temporary plan after clean review in the same
   final push, and observe CI. Keep execution evidence on the PR.

## Acceptance and boundaries

Googlesource resolve emits replayable HTTPS and preserves its distinct canonical
key in JSON. Scoped site searchTarget survives unchanged. Best/protected matches,
confidence/security decisions and group identity remain canonical. Tests assert
wire fields for both compact/detailed modes and absence of over-fetch in
similarity evidence. Full live smoke gets past recovery with all recovery facts
and native actions checked. No new provider syntax, network client, API, storage,
queue, cache, flag or retry mechanism; no other-repo edits. No performance
optimization or benchmark claim. New required service fields are intentional
public type additions and need release notes; public skill instructions remain
accurate and no skill lifecycle changes are needed.

Remaining work: external code review, plan cleanup and final PR delivery.
The Docker recovery backlog item is closed after complete dev/prod smoke;
execution counts/results belong on PR 528. Package validation and agent-eval
inspection are complete.

Completion: implementation contracts updated; verification/review on PR; plan
removed only after clean review. Any genuinely major deferred work is recorded
in backlog with the user's decision, never left as an unowned TODO.
