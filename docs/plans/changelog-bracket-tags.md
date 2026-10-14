# Changelog bracket tags

Status: READY FOR REVIEW. Owner follow-up after compact-tag delivery in PR476.
Base40c2ade; shared changelog formatter owns this presentation-only change.

Owner-observed i prefix is confusing. Move action emphasis inside the kind tag:
[!behavior], with red optional; should-know is [deprecation], yellow optional.
Action without kind uses [!]; should-know without kind uses [should know] so it
cannot look like no impact. Uncertainty remains explicit and muted. No-impact
stays plain; null/oversize assessment status tags remain. One short legend explains
markers and plain bullets. Backend kind names/spelling and ambiguity stay unchanged.
No JSON, GraphQL, filters, collection, upgrade-review or backend changes.

Verify focused formatter/CLI/MCP parity and upgrade regression cases, build and
 typecheck, source/built smoke gates, normal authenticated dev Express4.22.0 and
5.2.1 text parity. Baseline built Express4.20.0 is5688bytes; compare final bytes,
not speed. Complexity remains85/88/113 (unchanged selections). Targeted exact
release agent trace only. Internal code preflight then retained Opus review for
this new owner increment, fix findings within three rounds. Commit/push to same
PR476; do not merge. Move evidence to permanent docs/delete plan after clean review.

Evidence: focused165/0 tests (1013 assertions); build/typecheck/Biome pass.
Dev built CLI/local MCP text parity passes4.22.0,4.20.0,5.2.1; bytes2341,
5687,1157. Baseline4.20.0=5688bytes; no speed claim. Source smokes pass, built
MCP passes and built CLI in progress. Descriptor-intent exact workload succeeds
19.1s/3 calls; trace/final/metrics inspected, rollback/rejectedCVE cited, zero
isolation violations, no quality grade. Internal direction/code preflight found
only two stale assertions, corrected and focused suite rerun; no code findings.
