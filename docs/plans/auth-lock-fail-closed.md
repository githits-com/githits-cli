# Plan: Fail-closed cross-process auth locking

## Overall objective

Status: in progress

Prevent concurrent CLI and local MCP processes from spending the same rotating
OAuth refresh token when process-identity inspection is temporarily
unavailable. The per-user auth lock must remain authoritative until its owner
is proven dead or its recorded PID is proven to belong to a different process.

Expected outcome: Windows process-start lookup failures can delay stale-lock
recovery, but can never cause a live lock to be deleted. Contending processes
continue to converge on the refresh result persisted by the lock owner.

Assumptions:

- `process.kill(pid, 0)` reporting success or `EPERM` is sufficient evidence
  that a PID is currently occupied.
- A missing or failed process-start lookup is unknown evidence, not proof that
  the recorded owner died.
- Waiting up to one second before rechecking stale ownership is acceptable;
  normal lock release is still detected by the existing 25 ms lock-acquisition
  retry.

Unknowns or product decisions: none. The required behavior follows from the
existing single-use refresh-token and per-user locking contracts.

Dependencies: existing `LockedAuthStorage`, process inspection helpers, token
manager integration coverage, auth implementation documentation, and root CLI
release-fragment validation.

Acceptance criteria:

- A live PID with an unavailable or failed start-time lookup retains its lock.
- A definitely dead PID or a PID whose start time differs from the recorded
  owner remains reclaimable.
- Live-owner process inspection is throttled independently from the fast check
  for ordinary lock release.
- Concurrent token-manager tests, the full unit suite, build, plugin checks,
  and required CLI/MCP smoke suites pass.
- Durable auth documentation and a `githits: patch`, `@githits/mcp: none`
  changelog fragment describe the corrected contract.

## Verified current state

`LockedAuthStorage` stores the owner PID and process start time in
`~/.githits/auth.lock/owner.json`. A contender first verifies that the PID is
occupied and then queries the start time through PowerShell on Windows or `ps`
on POSIX. `getProcessStartedAt()` converts inspection failures to `null`, while
`isOriginalProcessAlive()` currently compares that `null` directly with the
recorded non-null timestamp. The mismatch is interpreted as a dead owner and
`reclaimStaleLock()` removes the live lock.

A local reproduction using the production class confirmed that a contender
entered the critical section while the recorded owner PID was still alive when
the injected start-time lookup returned `null`. The released tests mock owner
liveness or cover successful identity lookup; they do not cover unknown
identity evidence. Contenders also perform the heavyweight identity check on
every 25 ms retry.

## Scope and non-goals

In scope:

- fail-closed owner liveness and PID-identity handling;
- bounded stale-owner inspection frequency;
- focused unit and token-manager regression coverage;
- auth implementation documentation and release impact;
- verification, review, commit, and draft PR.

Non-goals:

- changing OAuth error response parsing or terminal wording;
- changing token rotation, storage formats, keychain chunking, or auth modes;
- adding dependencies or replacing the directory-lock design;
- changing public MCP package APIs or hosted remote MCP behavior.

## Target architecture

The lock remains a per-user atomic directory. Fast acquisition retries continue
to detect normal owner release. Stale reclamation becomes conservative:

1. A definitely absent PID permits reclamation.
2. An occupied PID with no recorded start time retains the lock.
3. An occupied PID with a matching observed start time retains the lock.
4. An occupied PID with a different observed start time permits reclamation as
   PID reuse.
5. An unavailable or failed start-time observation retains the lock.

Stale-owner inspection runs immediately on contention and then at a bounded
interval, avoiding repeated PowerShell or `ps` process creation while an owner
is performing a network refresh. The existing lock timeout remains the final
bounded failure mode.

Security and compatibility: fail-closed behavior protects rotating credentials
at the cost of a bounded timeout when stale ownership cannot be proven. No
credential values, file formats, public APIs, or configuration contracts
change. Rollback is a normal code revert; no migration is required.

## Phase 1: Implement and prove the lock invariant

Status: complete

Expected outcome: `LockedAuthStorage` cannot reclaim a live lock because of
unknown process inspection, and waiters do not repeatedly launch heavyweight
identity probes at the 25 ms acquisition cadence.

Assumptions: the target architecture above is sufficient without changing the
lock file schema.

Unknowns or product decisions: none.

Dependencies: `src/services/locked-auth-storage.ts`, its unit tests,
token-manager integration tests, and `docs/implementation/auth.md`.

Implementation steps:

1. Make PID probe errors other than definite absence conservative and make a
   missing/rejected start-time lookup preserve the owner.
2. Separate the stale-owner inspection interval from the fast mkdir retry.
3. Add focused tests for unavailable and rejected identity lookup, PID reuse,
   and bounded live-owner inspection.
4. Re-run the existing concurrent token-manager regression tests.
5. Update durable auth documentation and add an independent patch fragment.

Edge cases: owner file creation races, ownerless stale directories, PID reuse,
permission-denied liveness probes, and lock release between failed acquisition
and stale inspection must preserve their existing safe behavior.

Acceptance criteria: every overall behavioral criterion is covered by focused
tests and the complete revised lock artifact has no path that converts unknown
owner evidence into deletion.

## Phase 2: Validate, review, and deliver

Status: in progress

Expected outcome: a reviewed, committed increment is available in a draft PR
without unrelated changes.

Assumptions: no review finding requires a product decision or material scope
expansion.

Unknowns or product decisions: none.

Dependencies: Phase 1, repository validation commands, internal Codex review,
Claude Opus review, GitHub authentication, and CI.

Acceptance criteria:

- Targeted and full tests, typecheck, formatting, lint, build, plugin generation
  checks, and required auth-related smoke suites complete with recorded results.
- Internal Codex and Claude Opus reviews settle cleanly; accepted findings are
  fixed and revalidated.
- Coherent conventional commits are pushed and a draft PR against `main` is
  opened with validation evidence.

## Phase-boundary reorientation

After Phase 1, re-read the full changed lock implementation, directly related
tests, auth documentation, and release fragment. Reconcile observed validation
with the assumptions above before dispatching review. If review exposes a
different failure class or a product decision, stop and revise this plan rather
than broadening the increment implicitly.

## Completion and plan cleanup

The effort is complete when the draft PR is open, CI status is reported, and
the Claude reviewer is retained for follow-up through merge approval. Durable
lock behavior must remain in `docs/implementation/auth.md` and release impact in
`changes/`; after the clean review, this temporary plan can be removed before
the final delivery commit.
