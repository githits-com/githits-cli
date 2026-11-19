# Effective package assessments in CLI and MCP

## Approved outcome and ownership

Resume held PR #569 after backend #4350 was implemented, reviewed and delivered
to dev. The governing scope is the client adoption section of the backend
`docs/plans/VULNERABILITY_COVERAGE.md`; the durable assessment contract is
`docs/implementation/VULNERABILITY_SYNC.md` (retained source assessments).

Backend owns semantic identity, own-entry attribution and effective assessment:
usable exact PACKAGE-version evidence first, qualified exact-release PACKAGE Git
fills missing facts. Broader or lower-fit evidence remains provenance and cannot
change a resolved package verdict, count, reasons, completeness or fix eligibility.
Clients project those decisions without recomputing precedence or alias unions.
A genuinely unresolved or standalone Related finding remains explicit, outside
package counts; it is not a request for callers to reconcile advisories manually.

Core already selects the six consumed packageInfo.security scalars and exact
registry/name/resolvedVersion proof in one overview request. The shared formatters
own concise presentation, with the existing assessment helper owning reason
wording. Preserve the legacy root only for metadata and native package history.
Resolved results receive no source-processing caveat or manual ALL/verbose remedy.
Remove the compensating follow-up builder and its formatter-only surface option;
keep genuine uncertainty as facts with no new command dump or recovery promise.

## Contract and compatibility

- Keep compact requests free of heavy provenance and source bodies. Preserve the
  existing verbose/JSON evidence and full OSV-detail projection, including
  schemaVersion, relatedIds, upstreamIds, credits and contentSafety.
- Preserve optional version/default release, history, severity, withdrawal and
  scope behavior. Do not add a deciding-evidence field or separate source report.
- Selected security and native history remain independent. Mismatched/absent
  selected data never becomes zero/false or a native-current fallback. GraphQL
  null propagation invalidates all affected facets, while valid siblings survive
  nullable errors; auth/access/update remain fatal.
- Published vulnerabilities.recent stays as a deprecated identical alias of
  advisoryHistory.recent when selected security and history exist. Keep current
  row breadth/omission and text history once; no removal is authorized.
- Retain raw per-original evidence, including contradictory lower-fit outcomes,
  without deriving a client warning from them. Native upgrade candidates are not
  a guarantee that a candidate fixes every possible source finding.
- No backend edits, new infrastructure, source acquisition experiments, public
  tool flags, credentials access, merge, release, publish or deploy.

## Implementation and verification

1. Align overview and direct text with backend effective fields. Simplify the
   shared reason wording and remove the manual-analysis workaround. Update
   durable client docs and the existing pending minor fragment for both artifacts.
2. Add bounded same-CVE regression fixtures: resolved PACKAGE negative plus raw
   Related positive stays complete/no caveat; an effective positive stays positive
   beside raw negative evidence. Preserve raw JSON, native metadata and history.
   Test genuine unknown/preparing/not-assessed/unavailable/Related-only and future
   uncertainty without manufacturing a package finding or manual remedy.
3. Run focused changed suites, typecheck/build/package validation and required
   source/built CLI/MCP smoke. Compare compact/verbose/JSON and pinned reports on
   held dev lodash4.18.1, minimatch11.0.9 and minimatch10.2.1. Preserve source facts,
   bindings, evaluation clocks and scoped jobs before/after through the parent
   owner's guarded helper. No requests to manufacture a cold case.
4. Verify the complete overview document and compact/detailed query selections;
   retain the <=500 budget (prior complete cost 103). Qualify full existing detail
   fields and normal filter modes, not a reduced illustrative projection.
5. Re-review the full client delta against the delivered contract, retaining the
   client Opus reviewer through merge approval. Update the draft and verify CI
   on the final head. Prior green reviews do not establish acceptance of the
   rejected manual-analysis output.

## Remaining gates

The isolated qualitative agent evaluation previously failed before tool use due
to missing noninteractive authentication. It is not passed or waived: complete it
when the private operator prerequisite is restored, or obtain Juha's explicit
acceptance of the gap before claiming full verification. Do not inspect/copy auth
files or Keychain data, retry known failed authentication, or switch models.

Execution evidence belongs on PR #569, not permanent implementation docs. Retire
this plan with the final clean increment once the remaining gates are satisfied;
durable contracts belong in implementation docs. PR #567 remains independent.
Client merge/release and production delivery require separate approvals.
