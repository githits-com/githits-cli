# Upgrade review: updated backend risk contract

Status: IMPLEMENTED; internal review clean; CI/delivery pending. Same draft PR463. No merge or backend edits.

## Outcome and ownership

CLI and local MCP show low-confidence agent classifications as uncertain, reserve the oversize section for UNCLASSIFIED, and rank batches by confident action counts. Shared formatter owns presentation and the single 0.4 boundary; backend owns tier resolution, kind threshold, jobs and stored provenance. No new query fields, client reclassification, retry machinery or infrastructure.

## Verified state

Current formatter renders all MUST_ACT with the same heading/count and labels UNCLASSIFIED as general ambiguity. Authenticated dev JSON at exact prescribed endpoints confirms the changed contract:

| Range | Confident / uncertain act | Confident / uncertain know | Oversize | Classified / pending / without notes | No impact | Omitted | Formulation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| express 5.0.0..5.2.1 | 0 / 8 | 6 / 2 | 0 | 4 / 0 / 0 | 125 | 0 | s-hier-v2 |
| express 4.19.2..4.21.2 | 3 / 1 | 8 / 2 | 0 | 4 / 0 / 0 | 43 | 0 | s-hier-v3 |
| biome 2.4.2..2.4.15 | 13 / 28 | 9 / 0 | 0 | 13 / 0 / 0 | 812 | 13 | s-hier-v2 |

Express old range includes low-confidence internal deps removals (0.19–0.23). Old Express means5.0.0..5.2.1, new Express means4.19.2..4.21.2. Baseline /tmp/risk-v3-express-before.txt uses /tmp/risk-v3-express-old.json at width200; after rendering uses the identical JSON, so before/after isolate formatter behavior. Local backend checkout is #3041 and predates #3060/#3063/#3064; its old SDL descriptions are not deployed-contract evidence. Field names/types are unchanged and dev successfully returns every selected field. Prior introspection was disabled; user contract and deployed data govern semantic changes. Production deployment is pending; no production probes or rollout mechanisms.

## Rendering rules

- Uncertain means numeric tierConfidence <0.4, including zero; exactly0.4 is confident. Null/omitted confidence belongs only to oversize UNCLASSIFIED under the new contract. Do not derive a tier or kind from quote wording or confidence.
- Per version, confident MUST_ACT remains Requires action, low-confidence MUST_ACT moves to Possibly requires action with an explicit muted `(uncertain)` marker. Both keep full quoted evidence. Section order is Requires action, Possibly requires action, Should know, Too long to classify - read it. Oversize count is all returned UNCLASSIFIED items, not uncertain items. SHOULD_KNOW remains its tier with low-confidence items explicitly marked uncertain and confident rows first. UNCLASSIFIED becomes Too long to classify - read it; it has no numeric confidence and is not an uncertain escalation. Other tiers retain compact240-codepoint/verbose expansion, backend truncation markers and source locators.
- Detail and batch counts separate confident and uncertain act/know: e.g. `4 act (+2 uncertain)`. Batch sorts only by confident MUST_ACT count; ties retain backend order, JSON order untouched. Rare oversize counts say too long to classify. Batch footnote explains confidence0.4 boundary, confident-only ranking, returned counts including oversize and duplicate-source statements, omitted exclusions and no compatibility verdict. Existing peer/security/dependency/keyword evidence retained.
- Coverage remains one combined summary. versionsNotAssessed remains the not-assessed count: jobs are still running or may have failed. Pending coverage suggests rerunning a few seconds to a minute later to retrieve completed labels from storage without rerunning the model; it does not guarantee that a failed job completed. No client polling/retries and no safety inference.
- Keep all per-item model/formulation values in JSON, including mixed formulations within one review. Text identifies agent classification without model versions. Kind labels are rendered whenever supplied; no client 0.7 filter (existing renderer already obeys this).

Assumptions: deployed semantic contract supplied by owner applies; model/formulation are opaque per-item provenance. Labels may be mixed because storage survives classifier changes. Requested ranges were already classified, so no fresh cold-job claim. Product decisions/unknowns: none. No backend contract contradiction observed in the three payloads.

## One implementation increment

Status: READY after plan review. Dependencies: existing aggregate query, normal dev CLI auth, shared formatter/parity harness. Expected outcome: uncertain internal-deps statements remain quoted but cannot inflate confident-action ranking.

1. Add one shared confidence predicate/count rule; update detail grouping/counts, muted marker, oversize label and batch sort. Update pending-job wording in detail/batch. Keep query/schema/JSON mapping unchanged.
2. Update fixtures to the deployed semantic contract; tests cover0/.399/.4/1, both classified tiers, missing kinds, oversize null confidence, all uncertain batch versus confident packages and stable ties, mixed provenance JSON, omitted items/pending coverage/truncation, colors and CLI/MCP parity. Preserve keyword/source/bullets behavior.
3. Update permanent implementation/CLI docs and existing release fragment; remove superseded request-time deadline semantics. Validate focused Bun tests, typecheck/Biome/build/packages, required source/built smokes and normal-auth dev CLI/local MCP requested ranges plus batch. Compare saved Express response before/after; report counts, omitted data and unchanged selection/complexity284. No runtime optimization claim or benchmark.
4. Internal plan and implementation review. External plan review is its own scope. Existing same-PR code review cap was reached in round3; do not dispatch a fourth external code review. Fix/verify any internal findings and report the limitation.
5. Commit/push/update existing draft PR463 and await CI. Transfer final evidence to permanent docs, delete this working plan in final closure commit after review. No deferred work, merge or backend changes.

Acceptance: old Express renders0 confident acts plus8 uncertain actions, deps-removal quotes visibly uncertain; new Express3+1; Biome13+28 and13 omitted. Batch order Biome, new Express, old Express; all three lines retain factual evidence. JSON unchanged, mixed provenance faithful. Oversize only as too-long section, low-confidence known tiers never appear with confident-action weight. All checks pass or any external service limitation is reported accurately.


Plan review closure: internal direction sound/no findings. External direction sound; accepted F1 wording clarification (not-assessed maps to running/failed jobs; retrieve completed storage labels, no guaranteed failed-job recovery); owner explicitly supplied no-new-model-spend contract, so rejected demand to independently infer backend spend. Rejected F2 secondary uncertain-count ranking on2026-10-07: conflicts with owner instruction not to rank by low-confidence escalations and would suggest packages with zero returned actions are clean. Accepted F3 explicit section order/oversize count/footnote; accepted F4 names and baseline paths. No scope/architecture/acceptance change, no further plan round required. No deferred work.


Implementation evidence: full bun test5,645pass0fail22,680assertions235files; typecheck/Biome/build/packages and all4 source/built smokes pass. Normal-auth dev CLI/MCP all3 requested ranges and batch pass; JSON riskItems/coverage parity verified without imposing order among backend ties. Batch order/counts match table. Same-response before/after files show Requires action6 ->Possibly requires action6 and explicit uncertain deps-removal quotes. Query unchanged. Targeted Claude agent:e2e attempted; CLI not logged in, zero toolcalls/no final grade, unavailable qualitative check rather than success. No app login/token handling attempted. No backend contract contradiction.

Internal final implementation review: direction sound, no findings. All accepted plan notes closed; no deferred implementation/refactoring work.
