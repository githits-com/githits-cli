# Upgrade review: version-focused changelog evidence

Status: IMPLEMENTED; code review pending. One user-directed revision to existing draft PR463; no merge.

## Outcome and ownership

Changes becomes a useful release-by-release review: one block per version, combining classified statements and keyword evidence from releases and changelog files. Sources are linked once via references, agent classification identified without model/formulation in text, no separate sampled/heuristic entry dumps. JSON stays faithful, backend unchanged. Shared formatter naturally owns presentation for CLI/MCP; core/backend keep wire/classification ownership.

## Verified evidence

User inspected Express 5.0.0..5.2.1:11 statements, 4 classified versions, 130 no-impact units, duplicate version/source scaffolding. Normal-auth exact dev JSON confirms4 entries, the same entries repeated in sampledEntries and keywordEntries, risk statements across releases/changelog_file, markdown URLs consuming excerpt lengths, and the5.2.1revert warning split across both sources. Latest owner schema priv/graphql/schema.graphql has risk version/source but no per-statement entryURL/identity. Entry URLs are available only for selected sources. Current query284 / 500 and all fields still consumed in JSON/verbose; no selection change, fanout or backend modification required.

## Architecture and rules

- In existing shared response formatter, build version groups from riskItems and keyword entries. Use returned release-entry order (Express is newest-first), then append statement-only versions in backend order. Do not invent cross-registry version chronology with the semver-ish comparator. Within each version preserve tier priority act/know/unclassified and backend order. One version heading; quotes don't repeat their version. Risk-only versions beyond ordinary entry cap still render.
- Lead with returned tier counts, then compact coverage: classified/not-assessed/without-notes always visible; unparseable included when positive; no-impact count only. Positive omitted/pending/missing/unparseable add limits/rerun guidance. Show package-version fallback when notes unavailable and entry-sampling limits when truncated; avoid repeating source-type/entry metadata already represented by references. No safety inference, package verdict or new classifications.
- Every returned risk item remains visible. Full action quotes, compact 240-codepoint prefixes for other tiers (URLs no longer consume quote content); verbose full text, headings/confidence. Local excerpts and backend truncation distinct. Generic expansion hint once. No model version/formulation text, including batch/verbose; retain fields in JSON.
- Render verified Markdown link/bullet/code/blockquote syntax as plain visible quote text, and GitHub alert markers as e.g. IMPORTANT:. Links become numbered references with URL shown once in Sources; quote words remain, no paraphrase/inference. Preserve Unicode, sanitize terminal controls before presentation, JSON unchanged. In-note HTTP(S) URLs and entry URLs share one URL reference registry per Changes block. Exact same version/source match required for entry URL; absent match never borrows another source locator. Each quote carries source references; a source with no exact matching entry URL gets a shared reference such as [n] Release notes (entry URL not returned), never a borrowed changelog_file URL. Unknown source gets an explicit unavailable-source reference.
- Combine keyword excerpts into their version. Keep breakingSignals/migrationSignals and entry signals consumption; mark keywords as heuristic, not agent labels. Suppress only a keyword statement already present in a risk item from the same version and explicitly matching source: compare the full unexcerpted keyword chunk by exact containment within normalized statement text, then tag the retained statement with the heuristic signal. Do not compare truncated display excerpts, not fuzzy semantic duplicates. Distinct wording and differing tiers remain distinct quoted evidence. No sample/headline sections for versions already covered by statements. Default hides entries with no statement or keyword evidence: no-impact remains a count, and aggregate coverage never identifies which specific versions are pending. Verbose adds returned note previews and locators for those versions in the same grouping.
- Batch stays sorted triage; remove model provenance columns, one agent-classification footer. Existing factual peer/security/dependency counts preserved.
- No new module/infrastructure/dependencies. Remove replaced private formatter helpers rather than keep dead alternate rendering paths.

Assumptions: normalization of observed Markdown is presentation, not semantic consolidation. Backend labels may disagree with later release statements; returned release order puts the observed Express revert notice before the earlier claimed fix, with quotes rather than a client verdict. Exact duplicate/keyword suppression never changes JSON counts. Unknown/product decisions: none for this verified revision. Semantic deduplication of paraphrases would need backend-owned identity, which is outside this revision and unnecessary for grouping; no such inference implemented.

## Implementation increment

Status: READY after plan review. Dependencies: existing schema/dev auth and shared formatter; verified.

1. Replace layered Changes rendering with version groups and referenced sources; keep raw JSON query/projection unchanged. Update batch trust wording. Remove dead helpers.
2. Tests: multi-source version shown once, URLs once across quote/entry/keyword, no model/formulation even verbose/batch, Markdown labels retain meaning, Unicode/control sanitization, excerpt/truncation distinction, additional keyword evidence and exact overlapping warning once, no-risk/pending/no-notes/omitted cases, versions outside entry cap, JSON preservation and CLI/MCP parity.
3. Update durable text contract/examples, CLI docs, descriptor body sentence (agent-classified quotes grouped by version, sources and coverage; JSON retains model provenance), verbose help where stale, existing changes fragment. No public skill or first descriptor sentence change unless needed; retain first-80 contracts. Run affected Bun tests, typecheck/Biome/build, source smokes with prior scoped file-auth setting, authenticated Express example plus original three ranges/batch and actual local MCP. Targeted descriptor eval trace inspection for revised agent behavior. No performance optimization claim or benchmark; compare output structure and size only as UX evidence.
4. Internal and external plan/code review. Reuse retained code reviewer for user revision; supply exact new delta and previous clean evidence, one external reviewer per round. Prior code rounds 1-2 clean closure remains; this revision receives remaining external code round3 under the loop limit. If that round has code findings, fix and validate them, then report the round limit and the fixes not re-reviewed; no fourth round.
5. Commit/push/update same draft PR463. After review cleanup, permanent docs hold observed behavior/verification and this plan is deleted in final commit. Never merge.

Acceptance: real Express Changes has4version headings, no repeated sample/heuristic entry sections, source URLs once, no model/formulation in text, faithful JSON and keyword evidence, explicit required coverage and quote limits. All requested surfaces pass affected checks/dev. No backend edits or unapproved machinery. No deferred implementation/refactoring work.

Internal plan review: direction sound. Accepted ordering clarification: reuse backend entry order rather than semver-ish comparator across registries. Accepted provenance clarification: overlapping keyword suppression requires same version and defined matching source; cross-source equal wording remains attributed separately. Labels were calibrated as UX correctness, not service blocking.

External plan review: direction sound. F1 accepted (full-chunk overlap and heuristic tag); F2 clarified (default evidence-only groups, coverage counts plus verbose locators), rejected its proposed empty-version list because no-impact is only a count and states cannot be attributed per version; F3 accepted (per-quote source refs and mock); F4 accepted (fallback/truncation limits), keep source names in references once; F5 accepted (descriptor/docs/fragment consistent agent wording, model provenance JSON); F6 clarified (round-limit reporting if code findings); F7 applied (spacing, commit plan with implementation). These clarify the settled formatter scope; no additional plan round needed. No deferred scope.

## Target shape (Express, excerpts shown for illustration)

```text
Changes - 0 require action | 6 should know | 5 unclassified
  Classification versions: 4 classified | 0 not assessed | 0 without notes
  130 statements labeled no impact
  5.2.1
    Unclassified - read if relevant
      "Revert security fix for CVE-2024-51999 [2] (GHSA-pj86-cfqh-vqx6 [3])" [1]
      "IMPORTANT: The prior release ... fully reverted in this release." [4]
        Heuristic: breaking
  5.2.0
    Should know
      security fix "Security fix for CVE-2024-51999 [2] (GHSA-pj86-cfqh-vqx6 [3])" [5]
      deprecation "add deprecation warnings for redirect arguments undefined by @bjohansebas in [7]" [6]
    Unclassified - read if relevant
      "deps: body-parser@^2.2.1" [5]
  5.1.0
    Should know
      security fix "fix(securite): fix vulnerabilities by @Abdel-Monaam-Aouini in [8]" [6]
  5.0.1
    Should know
      security fix "Update cookie semver lock to address CVE-2024-47764 [10]" [9]
  Sources
    [1] Changelog: <returned source URL>
    [2] <CVE URL>
    [3] <GHSA URL>
    [4] Release notes: <returned release URL>
    [5] Changelog: <returned source URL>
    [6] Release notes (entry URL not returned)
    ... each remaining URL once
  Classified by an agent. Not a compatibility verdict.
```

Verification: 5,638 full tests / 22,598 assertions and 55 focused tests / 769 assertions passed; typecheck/build/package, source auth-handling smokes and both built smokes passed. Normal-auth dev CLI Express and local MCP four ranges plus batch passed. Saved Express Changes 4,212 bytes / 69 lines -> 2,717 bytes / 52 lines at width 80, no runtime performance claim. Targeted descriptor eval passed with medium confidence, nine completed logical calls (three upgrade reviews), trace inspected, no quality grade. Final code review pending.

Internal code preflight: direction sound. Accepted source-list finding: quote excerpting removed a reference while still listing its late URL. Sources are now filtered by references in the actual rendered lines; no two-phase numbering mechanism needed. Checked statement and keyword paths, full action/verbose behavior and JSON preservation. Regression covers late links in both paths; full/verbose references remain visible.


Final external round3: direction sound; accepted low numeric-reference citation
collision. Root cause note-authored Markdown numbers shared display syntax with
formatter citations and source pruning. Fixed reference-style labels and numeric
markers in shared rendering, including verbose headings. Sibling scan all quote,
keyword and preview paths; raw JSON unchanged. Regression tests added. No fourth
external round under review limit; fix requires internal closure and verification
before final delivery. No deferred finding or backend change.
