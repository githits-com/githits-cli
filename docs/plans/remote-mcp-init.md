# Remote MCP init

The approved feature ships as a stack: PR505 contains host transport/configuration
support; PR514 contains the final connection menu, separate guidance selector and
direct CLI setup. Both are based on main8b69017 (GitHits/MCP0.39.0).

## Ownership and decisions

- Init owns connection selection, consent, review and auth orchestration. Host
  definitions own native transport, config and sign-in conventions. Main's
  complete-file skill executor owns skill references and lifecycle.
- Interactive setup defaults to remote MCP. Local MCP uses hosted MCP where
  required; experimental features remain opt-in. Direct CLI installs only the
  code/package skills with references. MCP guidance is a descriptive selector.
- Fresh unattended setup stays local-first; reruns preserve canonical transport
  unless a profile is explicitly selected. Claude Desktop uses its directory.
- Setup executors preserve config/instruction symlinks and unrelated settings;
  the prompt adapter owns terminal layout. No public skill or package version
  changes are included. Release-preparation onboarding and Gemini discovery
  verification remain in docs/plans/open-backlog.md.

## Phase 1 — host/configuration support (COMPLETE, PR505)

Native hosted configuration, auth instructions, canonical transport checks,
comment-preserving TOML edits, linked-file writes, migration disclosure and
partial-failure reporting are implemented. The combined final review covers
both phases. Verification and review evidence belongs on the PRs.

## Phase 2 — final setup flow (COMPLETE IN STACK, PR514)

The final four choices, separate MCP guidance consent, direct CLI skill setup,
compact terminal presentation and auth-aware readiness are implemented in the
stacked PR. Merge PR505 first and retarget PR514 to main for hosted CI. No merge
is authorized by the refresh request. PR514 removes this plan after the combined
review is clean; implementation docs contain the durable contract.

## Review boundary

The combined refresh reached its three-round external review limit. The final
round's ordinary findings are fixed and verified inline; no subsequent clean
external round is claimed. Exact review and verification evidence belongs on
PR505/514. Retain this plan until a clean review permits retirement; durable
behavior is already documented in docs/implementation/.

## User testing corrections (IN PROGRESS)

The user observed multiline option help, opaque MCP/transport suffixes,
next steps for unselected tools, and outdated Cursor instructions. This is a
bounded feedback increment on the existing stack. Init owns selected-target
reporting; the host catalog owns Cursor command/UI metadata. Correct both
branches and replay the child without changing install/auth policy.

Verified: unchangedAgents currently includes every configured tool; Cursor
current docs use Customize > MCPs and agent mcp, confirmed by installed Cursor
CLI 2026.09.18-9a7762b help. Assumption: one-line help targets ordinary 80-column
terminals; narrower terminals keep word wrapping. A scan with no selectable
changes retains its existing no-op report; explicit choices scope next steps.

Acceptance: descriptions contain no authored line breaks and fit 80 columns;
ordinary tool rows are names; choosing only Claude emits no Cursor/Codex sign-in
steps on success, guidance-only or failure paths. Selecting guidance repair
then declining keeps that selected host's no-op instructions. No changes are
made to unselected MCP config. Cursor human/JSON output uses current catalog
metadata. Verify targeted tests, actual 80/40-column PTY and required build/smoke
checks. Use the retained reviewer for a new bounded user-feedback round, after
internal pre-flight. Prior final external verdict remains accurately recorded.
