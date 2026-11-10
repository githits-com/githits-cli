# Native package lifecycle inspection

Status: IMPLEMENTED; implementation review and delivery pending. Expected outcome: `githits pkg info`
and MCP `pkg_info` expose the backend's native lifecycle assessment for their
existing unpinned default selected release, in text and JSON.

## Verified evidence and assumptions

- Own branch starts at origin/main d66edda; no other lane changes are included.
- Backend main bfe225204b4c3308237355cd8232e31b60e93b41 SDL and
  priv/graphql/CHANGELOG.md were fetched read-only via GitHub. Current schema hash
  fb3f34435601; lifecycle contract remains the additive contract delivered in
  backend PR 4115 (live dev verification supplied in handoff).
- `PackageIntelligenceServiceImpl.packageSummary` queries GraphQL directly, with
  an existing `provenance: packageInfo` root, then normalizes an overview. It
  attaches provenance only when selected versions match and there are no errors.
- `pkgInfoAction` and `createPackageSummaryTool` share the payload builder and
  text formatter in packages/mcp/src/shared/package-summary-response.ts.
- Neither overview surface currently renders legacy deprecation. Other tools do;
  they are outside this increment. No new interpreter or legacy fallback is needed.
- Verified SDL requires all four checks, arrays (including reasonCodes), and
  contentSafety.filtered. Finding version, sourceVersion, time, reason and
  replacement are nullable; reason codes may be empty. Preserve null affected
  version because it denotes a package-wide finding.
- Existing optional provenance-root failure behavior stays intact, including auth
  and client-update errors. Missing, errored, or mismatched lifecycle evidence must
  be unavailable, never a negative assessment. No fallback acquisition is added.

Unknowns/product decisions: none. Assumption: the supplied authenticated backend
proof suffices for pinned positives since pkg_info intentionally rejects pins;
prove all distinct cases deterministically through the actual service path.

## Architecture and scope

Backend owns native classification and safety normalization. Core service owns
wire selection/decoding and typed evidence, not policy. Put the small reusable
lifecycle schema and explicit public types in a core service module; the existing
large package-intelligence module imports it rather than growing another embedded
contract. Export types through core and the public MCP service-type barrel.
Categorical wire fields accept strings, with known-literal plus open-string public types
where useful, matching the existing resolve-target boundary. Future native values
remain visible verbatim, never interpreted as safe. Structural malformation still
fails the existing whole-response decoder; no fallback. A lifecycle resolver
error nulls the shared provenance root, also losing registryRepository.
PackageSummary has an optional lifecycle assessment; JSON adds this same block
losslessly, including empty findings, checks, retained warnings and safety state.
The shared summary formatter owns presentation for both CLI and MCP. Default text
shows native kinds/category/scope/affected identity, source authority and optional
reason/codes/replacement/time, retained legacy warnings once, and content filtering
when applied. Group lifecycle checks by status and reason in one wrapped row,
keeping the lifecycle label explicit to distinguish collection from the independent
GitHub archive badge. Publisher reasons/replacements are labeled in text; shared
caveats about advice, observation time and empty findings live once in the
descriptor. Wrap prose to width. JSON retains native registry casing within
lifecycle evidence, consistent with its other native enums; the existing top-level
overview registry remains lowercase.

Keep all released overview keys, selected-release selection, vulnerability counts,
legacy tools, auth/setup, failure policy and repository archive metadata unchanged.
No new runtime dependencies, acquisition, infrastructure, flags, scans, Action
renderer or Scan changes. No release/version bump, merge, publish, or deploy.
Add a minor/minor release fragment for additive CLI/MCP evidence. Release ordering:
the target backend must serve packageInfo.selectedVersion.lifecycle before these
CLI/MCP versions are released. A missing schema field produces a pathless GraphQL
validation error and fails the overview; no schema fallback is introduced. Record
this precondition in the fragment and PR; production availability is not asserted.
Do not update public skills to describe this unreleased behavior: the existing
githits-package JSON guidance remains valid, and any new lifecycle-specific skill
prose follows the existing post-release Agent Skill lifecycle.

## Single implementation increment

Status: IMPLEMENTED, pending implementation review. Dependencies: settled backend contract above. Unknowns: none.
Expected outcome: native evidence survives HTTP decoding to CLI/MCP output without
invented negatives, duplicate legacy warnings or vulnerability-count changes.

1. Add lifecycle schema/types and select every consumed lifecycle field within
   existing packageInfo.selectedVersion in all modes; keep verbose directives for
   existing verbose-only fields. Attach lifecycle under the existing identity and
   error guards; no new network requests.
2. Add JSON block and shared width-aware text presentation. Keep native enums and
   nullable identities in JSON. Missing assessment text says unavailable.
3. Add minimal authored tests: npm deprecation and checked negative, PyPI yank with
   deprecation NOT_APPLICABLE, crates yank with separate NOT_COLLECTED deprecation,
   Go package-wide deprecation despite legacy false, NuGet retained warning with
   UNKNOWN native checks, absent/null optional fields, archival NOT_COLLECTED.
   Assert query selection/variables and real service decoding, then CLI/MCP JSON
   parity and text output. Cover filtered content, identity mismatch/root error,
   malformed contract, future categorical values, GitHub-archived plus lifecycle
   archival NOT_COLLECTED pairing, and compact/verbose/json wire behavior without paid scans.
4. Update durable mcp-cli-parity documentation, CLI help/MCP descriptor detail
   after unchanged selection sentence, and independent release fragment.
5. Run targeted bun tests, typecheck, full bun test, build, isolated CLI/MCP smoke.
   Read smoke/auth rules first; use secret-free modes to avoid manual paid work.
   Run a narrow agent eval only if it can obey no-paid-scans constraint, inspect
   tool-calls/final/metrics/isolation artifacts, and report any limitation. Reuse
   backend live proof; optional free dev metadata only after safe auth review.
6. Internal preflight then one external Claude reviewer per round to clean, coherent
   commit, push, draft PR and observe CI. Do not cancel CI. Keep reviewer for PR.

Acceptance: each distinct registry behavior above survives the causal path to both
surfaces; JSON has lossless typed evidence; text retains uncertainty, native scope,
authority and safety without treating lifecycle as advisories or inferred archival.
Existing overview behavior/tests remain valid. Package build and validation protect
public exports. Record execution results on PR, not permanent implementation docs.

Completion: after clean final review, move durable contract into implementation
docs and delete this temporary plan before final delivery push. Report tested,
reviewed draft PR directly to Juha with remaining limitations and CI status.

## Plan-review disposition

Internal preflight: direction sound, no findings. External round one: direction
sound. Accepted open-string categorical decoding (ordinary additive backend values
otherwise break the overview; small established boundary pattern), explicit
malformation/shared-root failure semantics, grouped check text and separate GitHub
archival source wording. No infrastructure or product scope added. Add fixture proof
for these cases. JSON native casing is preserved; descriptor format list names the
new lifecycle evidence block. No rejected findings or open product decisions.

External round two: clean after two minor wording fixes: release-ordering
precondition recorded above; public skill changes excluded until behavior release.
Fresh-context final plan check completed. No further plan review needed.

## Implementation evidence

Service selection and required lifecycle structure decoding, public evidence types,
shared JSON/text output, smoke contracts, CLI/MCP descriptor details, durable parity
documentation and release fragment are implemented. The core schema module owns
wire evidence; the existing shared formatter owns presentation, with no new policy
interpreter or network operation.

- 19 causal-path/layout cases pass; all required registry behaviors covered through HTTP
  fixture decoding and real CLI/MCP handlers. Existing targeted suite: 315 pass.
- Final full bun test after review fix: 7314 pass, 2 existing platform skips, 0 fail.
- Typecheck, build, isolated source CLI/MCP smoke, built Node CLI/MCP smoke and
  public-package validation pass. Changed TypeScript Biome check passes.
- Free dev metadata attempt produced no response while sampled in existing
  Keychain/keyring path; stopped only that owned process, changed no auth code.
- Targeted agent:e2e descriptor-intent attempt failed before a model turn with
  Not logged in (zero tool calls, no final.json or isolation-violations.json).
  metrics/report inspected; no qualitative lifecycle acceptance claimed.
- Supplied backend PR 4115 live-dev proof remains the authenticated backend evidence.
  No manual paid scans, production writes, release, merge or deployment performed.

No remaining product decisions or deferred implementation. Final internal/external
code review, stable commit, draft PR and CI observation remain. After clean review,
delete this plan in the final delivery changes; durable contract is already in the
pkg_info section of docs/implementation/mcp-cli-parity.md.

## Implementation review closure

External code round one: direction sound. Accepted low readability finding:
flat lifecycle detail/wrapped lines obscured grouping across multiple findings.
Root cause: every line was independently wrapped at column zero. Checked all
finding details, retained warnings, check lines and filtered-content text; now
explicit detail indentation and hanging continuations apply throughout this
block. Added multi-finding/long-reason/check-continuation regression coverage.
Kept complete native affected identity on each finding: it provides registry
context missing from the overview header and avoids implicit scope identity.
Minor fragment wording corrected to describe showing evidence and retain only
the durable backend-before-release precondition; execution availability stays
on the PR. Affected six-file tests (232 pass), full suite (7314 pass, 2 existing skips),
build, both source smoke modes and internal full-delta re-review pass. Awaiting
second external code review.
