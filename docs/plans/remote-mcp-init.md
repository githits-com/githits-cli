# Remote MCP init: final refresh

Status: IN PROGRESS (2026-11-04). Scope is the already approved PR505 hosted-MCP
foundation and PR514 connection/guidance selector plus direct CLI setup. No new
product decisions or architecture. The user requested refresh on current main
and a final combined UX/robustness pass before making remote the default.

## Verified state and ownership

- Main is 8b69017, GitHits/MCP0.39.0, 125 commits after the original base94f3952.
- Parent rebased cleanly; child replay conflicts are duplicate complete-skill
  support. Main's getSkillFilePaths/readSkillSourceFiles and existing skill
  executor own complete-file install/check/repair/removal. Keep them, remove
  the child's duplicate metadata/per-file mechanism and duplicate fragment.
- Init owns connection selection, guidance consent, review and CLI auth flow;
  host catalog owns native transport/auth/config conventions. Keep boundaries.
- Installed Codex0.166.0 reports hosted GitHits OAuth configured. User reports
  upstream token persistence fixed. Fresh-process authenticated calls verify
  local persistence; token expiry/refresh across time remains a separate limit.
- Public skills remain unchanged until release prep; no hosted-server changes,
  versions, release, merge or publication. Existing release backlog owns the
  onboarding update. Preserve comments/settings and user credentials.

Assumptions: approved defaults unchanged: interactive remote; fresh unattended
local-first; reruns preserve canonical transport unless profile explicit.
MCP guidance remains a descriptive selector, recommended by default; CLI route
installs only code/package skills with references and offers local auth.
Unknowns: final check findings and fresh OAuth validation results. No product
choice is pending. No performance optimization or benchmark claim.

## Phase 1 — refreshed branches retain approved behavior (IN PROGRESS)

Dependencies: current main and clean original worktrees (verified).
Outcome: both PRs rebased, duplicate skill support removed, current contracts
and tests consistent. Resolve verified integration issues inline; no additional
installer, transport framework or infrastructure. Compare parent and child
production deltas independently against their bases. Update stale durable docs
only where contracts changed; execution evidence belongs on PRs.
Acceptance: focused init tests/typecheck pass on both branches; main complete
skill lifecycle preserved. Commit refresh without pushing until final checks.

## Phase 2 — final confidence and delivery (PENDING)

Dependencies: phase1. Outcome: combined UX/robustness reviewed and fixes closed,
current validation on PRs and refreshed branches pushed. Existing tests cover
selection/auth/decline/cancel/config-preservation and platform shapes. Run full
Bun tests, build, plugins generate/check, CLI/MCP source+built smoke, format,
lint and public-package checks on final child; parent focused init/build checks.
Exercise real built terminal choices at80/40columns, project consent and CLI
files in disposable homes. Check two fresh native Codex remote sessions without
reading/printing credentials. Inspect actual MCP call results, not agent claims.
If authentication needs human interaction, ask only for that missing step.
The final review identified ordinary closure work: preserve config symlinks in
config setup/removal (not the credential writer), keep successful hosted auth
steps on partial failure, return nonzero for interactive failures and name
known config paths in probe errors without echoing contents. The child prompt
adapter completes confirmation/disabled-text wrapping and distinguishes unchecked
CLI auth from a confirmed missing login. These retain the approved flow.

Internal code_reviewer then one external Opus5.5 reviewer over combined delta,
max3 rounds for this new refresh scope. No review fanout; retain through merge.
Record exact verification and limits on PR505/514. Stacked CI's base-main filter
means child CI waits until retargeting; do not change infrastructure for this.
Retire plan with final changes after clean review; open deferrals stay backlog.
