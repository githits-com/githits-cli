# Resolve-target guidance refinement

Status: implementation and verification complete; internal review closed; external refinement round 1 findings fixed, round 2 pending.

The user requested one more pass over the tool, public skill, quick_start and
text output. The first 80 descriptor characters currently hide the vague-name
trigger. The resolver guide repeats canonical syntax, format and read-locator
rules already in the shared guide. Selection/continuation policy is settled.
This is within the existing GA guidance scope; no separate architecture or
product decision is needed. A separate plan review is skipped for wording only.

Ownership: MCP descriptors explain discovery and selected-tool use; quick_start
routes between tools and is copied exactly into the public skill; result text
owns the result-specific next action. Ranking and ambiguity classification
remain backend-owned. No schema, wire selection, JSON, gates or ranking changes.

1. Put the vague/misspelled-name trigger and canonical-target benefit in the
   first sentence (at most 79 characters). Remove repeated call mechanics from
   the descriptor/guide; preserve confidence and malicious-content rules.
2. Inspect real text, remove repeated instructions if present, and retain
   canonical locators, uncertainty, warnings and bounded evidence. Measure the
   same fixed output fixtures before/after any formatter wording edit.
3. Verify catalog prefix and guide/skill parity, existing gate/formatter tests,
   full unit suite, build, plugin checks, CLI/MCP smokes. Run the unchanged fuzzy
   descriptor and full-site workloads with Claude and Codex; inspect routes,
   final answers, metrics and isolation records. Canonical skip remains covered
   by deterministic tests and the prior unchanged Express workload.
4. Internal code review followed by the retained Opus reviewer. Commit/push the
   reviewed delta into draft PR #457; migrate evidence to the implementation
   doc and delete this plan in the final commit once review is clean.

Baseline: descriptor 1,121 UTF-8 bytes, full resolver definition 3,342,
quick_start 7,807, public skill 8,338. Exact text sizes are measured with the
existing scripts/agent-context-load.ts; they are not provider token counts.
Assumptions: shorter instructions may help routing, but agent runs cannot prove
causation or guarantee discovery. Prior Codex fuzzy run made zero GitHits calls.
Unknowns: new qualitative routes and the magnitude of text reduction, measured
during this pass. Dependencies: authenticated dev services and local adapters.
No new infrastructure or performance mechanism. Release/hosted adoption remains
separately authorized work; no production verification in this pass.


Measured result: 76-character first sentence; descriptor 1,121→577 bytes, full
resolver definition 3,342→2,796, guide 7,807→7,557, skill 8,338→8,088. Fixed
output fixtures EXACT 177→177, MEDIUM 210→170, ambiguous singleton 365→237,
empty 257→145, blocked 226→226. No output-size latency claim or token heuristic.
All four agent runs produced structured answers and zero isolation violations;
Claude fuzzy used resolver/source, both site runs used resolver/docs and preserved
MEDIUM uncertainty. Codex fuzzy still used web with no MCP calls. Full-guidance
runs did not call quick_start. Evidence and limitations are in the implementation
doc. Full units 5,486/0, type/lint/format/build, plugins and built smokes passed;
auth dev stable CLI/MCP and unchanged Research cohort passed.


Review closure: internal optional wording note restored "an actionable candidate"
in the guide/skill, with 25 parity/guidance tests passing. External refinement
round 1 found a small runtime-wording omission: ambiguous continuation lost
"or filters" while deduplicating the header. Restored filters in the final Next
action and its regression assertion; fixed fixture size is now 237 bytes.
159 affected adapter/guide/parity/script-smoke tests passed after the correction.
Release-note implementation detail and doubled doc blank lines were also removed.
The formatter owns continuation text; no ownership change or new mechanism.
