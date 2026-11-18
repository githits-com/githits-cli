# Combined selected-release security in package overviews

## Approved outcome and ownership

CLI `pkg info` and MCP `pkg_info` use the existing sibling `packageInfo.security`
observation for the exact displayed registry/name/resolvedVersion. Backend owns
attribution, identity, counts and uncertainty; core owns projection and matching;
the existing shared formatter owns presentation and compatibility. The legacy
`packageSummary` root remains only for metadata and native history. No backend,
new infrastructure, public flags or metadata migration is needed. PR #567 remains
on its independent docs branch and is not folded into this change.

Approved governing scope: `/tmp/vulnerability-overview-next/overview-client-approved-scope.md`.
No open product decisions. Main reorientation verified at `e4b25a1`. Optional
history and selected security remain independent. Registry comparison uses existing
normalization (`npm` / `NPM`); mismatched or failed security never falls back to
native current counts. Facet-specific errors preserve valid siblings; auth/access/
client-update errors remain fatal. Missing selected counts/affectedness are absent,
not zero/false; backend status is authoritative. Native history does not contain
all combined selected findings and is never a count bound.

Published `vulnerabilities.recent` is preserved and deprecated. Canonical
`advisoryHistory.recent` carries identical native history; alias exists only when
selected container and historical rows exist. Existing omission and row breadth
remain unchanged; text renders history once. New public fields stay optional.

## Implemented outcome and remaining gates

The service and shared formatter implement the contract above. Durable ownership,
output compatibility and delivery constraints live in
`docs/implementation/tools.md` (`pkg_info` response shape) and
`docs/implementation/package-vulnerability-assessments.md`. The final complete
query costs 103 (previously 87), below the 500 admission budget; this is static
admission proof, not a latency claim. Live overview observations preserve scoped
source-job and binding identities. Direct demand can move a missing-source reason
from `SOURCE_NOT_ASSESSED` to `SOURCE_PREPARING`; compare the same retained subject's
counts/verdict/completeness without requiring identical admission-state reasons.

Remaining before this final increment can be declared fully verified:

1. Obtain the required fresh Luna preflight and internal code review. Local
   reviewer starts failed before any verdict; the coordinator's Luna context also
   lacked its tool host. Restore the operator runtime/auth prerequisites without
   credential inspection or reviewer substitution.
2. Complete the fresh Opus 5.5 external review after the internal gate. No external
   round has run. Fix findings and retain the reviewer through merge approval.
3. Complete the existing targeted overview-vulnerability agent evaluation or
   obtain explicit user acceptance of its gap. Its isolated Claude process lacks
   noninteractive authentication; zero tool calls prove no product behavior.
4. Run draft-PR CI. Execution receipts, exact failed commands and blockers belong
   on the PR. Retire this plan with the final clean increment after these gates;
   the implementation docs already own the permanent contract.

One Luna implementor slice added only the explicit historical-alias regression.
Production selection, error semantics and presentation remained coordinator-owned.
No backend work, release or last-mile authorization is inferred from draft delivery.

## Acceptance and verification

Service tests cover actual casing, wrong registry/name/version, nullable history,
parent/security null, source-positive/history-zero, and security/selectedVersion/
parent errors plus fatal classifications. Wire modes keep one full two-root query,
six consumed security scalars and unchanged nonsecurity selections; omit evidence,
digests, sourceDetails, legacy current scalars and extra advisory pages.

Formatter/parity tests cover positive+incomplete, unknown/unsupported/unassessed/
future statuses, incomplete zero, independent history and selected evidence, exact
old/canonical history equality with existing omission, and text history once.
Run explicit changed suites, typecheck/build/package validation and source/built
CLI/MCP smoke required by AGENTS. Target only the existing overview-vulnerability
agent eval; no broad suite. Live dev uses canonical endpoints and standard auth
without handling secrets; full final document must validate and be admitted <=500.
Production availability stays a separate release gate. No merge/release/publish/
deploy authorized. Execution receipts go on the PR, not durable docs.
