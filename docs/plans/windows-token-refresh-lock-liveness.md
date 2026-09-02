# Plan: Windows token-refresh lock liveness

## Objective and expected outcome

Fix the Windows-only auth-lock handoff that can let simultaneous file-backed
`TokenManager` instances enter the refresh transaction twice. One expired,
single-use refresh token shared by CLI/MCP agents must result in exactly one
token-endpoint call, with every waiter returning the persisted refreshed access
token.

Status: INVESTIGATING — Windows diagnostic evidence required before implementation

## Verified current state and evidence

- This workspace is clean and based exactly on `origin/main` at
  `fd93ce18cf9577c981069009bc9b590abac332b7`; it does not contain the formatter
  feature branch.
- GitHub Actions run `33549408500`, attempt 1, Windows job `99994868762`
  rejected the aggregate promise in
  `TokenManager file-backed integration > makes one endpoint refresh for many
  simultaneous expired-token agents` after the first gated endpoint response
  was released. The same commit passed when the Windows job was rerun, and run
  `33540507877` passed before it. The adjacent force-refresh case passed in both
  attempts.
- The failing test creates twelve `LockedAuthStorage` and `TokenManager`
  instances in one Bun process. Every lock owner therefore records the current
  `process.pid`.
- `LockedAuthStorage.reclaimStaleLock()` currently calls `process.kill(pid, 0)`
  before comparing process start times. `ESRCH` is treated as definitive proof
  that the owner is dead, so a false `ESRCH` would delete the live owner's lock
  and admit another refresh transaction.
- Bun uses libuv `uv_kill(pid, 0)` for this Windows check. Public Windows Bun
  evidence records live PIDs producing `ESRCH`; libuv implements the check by
  opening the PID and maps `ERROR_INVALID_PARAMETER` to `UV_ESRCH`.
- For `pid === process.pid`, probing is unnecessary: the caller itself proves
  that the PID is live. The existing process-start comparison still distinguishes
  the current process from a stale lock left by an earlier process that reused
  the same PID.
- The failed job did not print the aggregate promise's inner rejection reason or
  record lock reclamation. The available log therefore does not prove that the
  current-PID `ESRCH` path caused this run, only that the path exists and fits
  the platform and contention shape.
- The passing force-refresh test first awaits all managers' initial token loads.
  That changes contention timing but not the lock contract; it does not
  contradict the live-owner reclamation path.

## Scope and non-goals

In scope:

- Diagnose the failed Windows handoff with instrumentation that records only
  lock state transitions and error codes, never credential values or paths.
- If the current-PID false-`ESRCH` path is observed, correct current-process
  liveness classification in `LockedAuthStorage`.
- Deterministic regression coverage for a Windows/Bun-style false `ESRCH` while
  preserving stale reused-PID reclamation.
- Durable auth implementation documentation and a root CLI patch fragment.
- Proportional unit, full-suite, typecheck, formatting, build, smoke, and
  package validation.

Not in scope:

- Timers, retries, polling, relaxed endpoint-count assertions, or test timeout
  changes.
- Replacing the lock protocol, changing token refresh policy, or changing
  callers.
- Upgrading Bun or retaining diagnostic CI configuration in the final delta.
  The test branch may temporarily isolate repeated Windows observations in a
  dedicated job so the full suite keeps its normal timing profile.
- Plugin manifests, MCP descriptors, public Agent Skills, or `@githits/mcp`
  behavior.
- External issues, releases, publishing, or deployment. The user explicitly
  authorized a temporary draft PR from the test branch to run Windows
  diagnostics; that PR is not authorization for a final PR or merge.

## Target architecture and ownership

`LockedAuthStorage` owns cross-process auth mutation exclusion, process-owner
identity, stale-owner reclamation, and lock handoff. `TokenManager` continues to
own token lifecycle policy and consumes the lock as one refresh transaction.
No boundary moves.

The liveness check will treat the current PID as live without calling the OS
PID probe, then use the existing start-time comparison. Other PIDs retain the
existing fail-closed behavior: only `ESRCH` proves absence; unavailable process
start evidence retains the lock. This is the smallest placement because moving
the rule into `TokenManager` would duplicate lock ownership and would not
protect other auth mutations.

Data flow remains:

1. A contender reads `owner.json`.
2. The lock validates PID liveness. The current PID is intrinsically live;
   other PIDs use the OS probe.
3. When a recorded start time exists, the lock compares it with the observed
   start time to reject a reused PID.
4. Only a definitely absent process or a definite start-time mismatch permits
   stale-owner reclamation.

## Assumptions and unknowns

Assumptions:

- The supplied run/job identifies the relevant failure; verified from the job
  log and repository source at its head SHA.
- Root CLI behavior changes; `@githits/mcp` does not, because local file-backed
  auth locking remains owned by the root CLI.

Unknowns:

- Whether run `33549408500` rejected because a live lock owner was reclaimed
  after a false current-PID `ESRCH`, because the winner failed while saving the
  refreshed token, or because of another release/reacquisition handoff. Resolve
  with a Windows run of focused, credential-free lock-transition diagnostics
  before implementation.

Product decisions: none.

## Compatibility, security, and operational considerations

- Security: fail-closed behavior is preserved. The fix removes one unreliable
  probe only when the owner PID is necessarily live and retains the start-time
  guard against PID reuse.
- Compatibility: Node, Bun, Windows, macOS, and Linux keep the same lock-file
  format and public interfaces.
- Performance: no optimization is proposed; the change avoids one redundant
  liveness syscall only for current-PID contention. No benchmark is needed for
  this correctness fix.
- Migration/rollback: no data migration. Reverting restores the faulty Windows
  liveness path without changing persisted data.

## Phase map

### Phase 1 — Current-process owners cannot be falsely reclaimed (NOT READY)

Expected outcome: Windows/Bun-style false `ESRCH` cannot admit a second auth
transaction for a lock held by the current process, while a stale lock with the
same reused PID remains reclaimable.

Assumptions: the current-PID false-`ESRCH` path is confirmed by the required
Windows diagnostic run before implementation begins.

Unknowns: the exact failed handoff described above. Product decisions: none.

Dependencies: none beyond the current default-branch source and existing test
helpers.

Detailed implementation:

1. Before implementation, run focused Windows diagnostics that capture the
   aggregate rejection reason, endpoint-call indexes, and lock owner lifecycle
   using synthetic token values only. Do not retain this temporary
   instrumentation in the production delta.
2. If the diagnostic confirms false current-PID liveness, add a current-PID
   fast path to the lock's process-liveness helper without
   changing other PID error classification.
3. Add a deterministic two-storage behavioral test: hold the first critical
   section, make the second encounter the current-PID owner while the injected
   PID probe reports absence, prove the second section cannot enter before
   release, then prove it enters afterward. Retain or extend the existing
   start-time mismatch case to prove a stale owner with a reused current PID is
   still reclaimed.
4. Re-run the focused lock and token-manager integration tests, including the
   original twelve-manager case repeatedly enough to exercise scheduling while
   keeping assertions unchanged.
5. Update `docs/implementation/auth.md` with the current-PID rule and add an
   independent `changes/*.fixed.md` fragment for `githits: patch` and
   `@githits/mcp: none`.
6. Run `bun test`, typecheck/format checks, build, CLI/MCP smoke suites, built
   smoke suites where applicable, and public-package validation. Do not run
   plugin generation because no canonical plugin input changes.

Acceptance criteria:

- Focused Windows diagnostics identify the exact rejection and lock/storage
  transition from the failing contention shape.
- If false current-PID `ESRCH` is confirmed, a simulated Windows/Bun false
  `ESRCH` for `process.pid` cannot admit the waiting critical section before the
  live owner releases it.
- A recorded start time that differs from the current process start time still
  permits reclaiming a stale reused-PID owner.
- The unchanged twelve-manager integration assertion observes one endpoint
  refresh and twelve identical refreshed access tokens.
- Focused tests, `bun test`, typecheck, formatting, build, smoke, and package
  validation pass, or any environment-only limitation is reported exactly.
- Durable auth documentation and release impact match the implementation.

## Phase-boundary reorientation and completion

There is one implementation phase, so no inter-phase reorientation is needed.
After implementation and review, re-read the delta against this plan and
`origin/main`, transfer all durable facts to `docs/implementation/auth.md`, and
delete this plan. Completion requires no unresolved test failures, review
findings, contradictions, or deferred minor work.
