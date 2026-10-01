# Search snapshot presentation

Status: implementation in progress; single increment from the user's 2026-10-01 handoff.

Outcome: agents can use served repository evidence while requested HEAD indexes;
waiting is conditional on needing updated results. No new backend fields, flags,
waiting behavior, or JSON changes.

Verified origin/main: both initial search and search-status share
`unified-search-presentation.ts` and `unified-search-text.ts`. The projection
uses evidenceNotice presence and discards its copy, then always chooses an active
status wait; it also recommends status reads for completed mutable evidence.
Existing GraphQL selection already includes requested kind/ref, requested and
served commits, freshness/reason, indexingRef, and emitted readTarget.

Assumptions verified against the supplied dev response and client contracts:
served.gitRef is historical indexing provenance, not a current branch pointer;
completed=false describes search lifecycle, while partialResults describes
omitted pairs; actual returned hits establish usable evidence. Neither indexing
alone nor timestamps establish commit freshness. Request kinds are open strings;
only repo_default_branch/repo_head prove HEAD intent. No product decisions or
missing backend data remain. Backend #2909 is deployed on dev; production rollout
is unknown. Q04 benchmark evidence is observational, not a controlled comparison.

Ownership: shared semantic projection chooses evidence and continuation; shared
text formatter writes it and preserves producer-selected read arguments. CLI/MCP
adapters and JSON projection retain their contracts.

Acceptance: test actual initial/status text with prior HEAD snapshots (historical
HEAD/named/missing/SHA refs), missing proof, no hits/no fallback, same-SHA refresh,
explicit branch/tag/commit, mixed/withheld pairs, and active/terminal lifecycle.
Ordinary lookup leads to use/read; optional active status syntax remains callable.
Pagination and pinned reads remain correct, JSON unchanged. Current completed
hits keep their compact presentation. Run focused tests, typecheck/build, local
dev CLI/MCP smoke, a targeted qualitative agent eval, and clean internal + Opus
review before a draft PR. Live pending states may finish; recorded fixtures prove
those cases without resetting indexes. No benchmark or backend worktree edits.

Completion: record results in durable implementation docs and PR; delete this
plan in the final commit after the code review is clean. No deferred work.
