# Grep context clamping

User-authorized addition to PR #377. Shared grep request normalization owns
CLI/MCP clamping; backend maximum stays 10. Verified baseline: eight rejected
calls in candidate evals, seven submitted in one batch with after-context 12.
Existing boundary tests reproduce rejection. No latency/token savings claim
until rerun; historical matched results must remain unchanged.

Implement nonnegative integer input with per-side overrides, cap effective
context at 10, expose requested/effective values only when reduced, and render
an actionable notice in MCP text and CLI stderr. Keep invalid numbers rejected.
Update selected tool description to route larger windows to code_read. No skill
or backend behavior changes. Fragment handling independently dispatched via
Orca to pkgseer-backend/docs-fragment-resolution.

Validate request/schema/CLI-MCP parity and text/no-match cases, build, smoke,
and descriptor agent evaluation. Add patch fragment for both artifacts and
permanent findings. Commit/push/update PR; no merge or release.
