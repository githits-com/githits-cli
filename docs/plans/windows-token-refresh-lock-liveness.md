# Plan: Windows auth-lock directory handoff

## Objective and expected outcome

Fix the Windows-only lock-directory handoff that intermittently rejects one of
many file-backed `TokenManager` callers after a single successful endpoint
refresh. Twelve agents sharing one expired, single-use refresh token must make
exactly one endpoint call and all return the persisted access token.

Overall status: IMPLEMENTING — focused tests and typecheck pass; Windows stress
validation is pending.

Overall assumptions: the four credential-free Windows reproductions identify
the same failure class as the supplied CI failure; the original job did not log
its inner error, so this is supported by matching test shape and platform rather
than an error-code record from that exact job.

Overall unknowns or product decisions: none. The required behavior and the
prohibition on retry-based fixes are explicit.

## Verified evidence and root cause

- This branch started exactly at `origin/main`
  `fd93ce18cf9577c981069009bc9b590abac332b7` and is independent of PR #341.
- Original run `33549408500`, Windows job `99994868762`, rejected the aggregate
  promise after the first gated response. Its log did not include the inner
  error, so it did not prove a second refresh.
- Credential-free diagnostics on draft PR #346 reproduced the same test shape:
  - run `33662606480`, job `100356528276`, attempt 28 made one endpoint call and
    rejected with `EPERM`;
  - run `33662998086`, job `100357822876`, attempt 16 repeated one endpoint call
    and `EPERM` with no token-file atomic-write failure;
  - run `33664206992`, job `100361805871`, attempt 21 identified the failing
    operation as creation of the `auth.lock` directory;
  - run `33664635613`, job `100363227791`, attempt 2 identified
    `create-lock-directory`, `EPERM`, and `ownerState: "missing"` together.
- The endpoint count remained one and no live-owner liveness or stale-reclaim
  event occurred. The second-refresh/current-PID-`ESRCH` hypothesis is rejected.
  A separate Windows run completed 50,000 `process.kill(process.pid, 0)` probes
  without error.
- `LockedAuthStorage.releaseLock()` deletes `owner.json` and then removes the
  now-empty `auth.lock` directory. Waiters concurrently call `mkdir(auth.lock)`.
  On Bun 1.4.0 build `34cbb9a40`/Windows, as recorded in the diagnostic job log,
  a create that overlaps this ownerless directory removal can report `EPERM`
  rather than `EEXIST` or `ENOENT`. The current acquisition state machine
  propagates that platform result even though the endpoint refresh already
  completed and the outgoing owner was releasing the lock.
- `EPERM` plus a missing owner identifies where the observed failure occurred;
  it does not uniquely prove transient contention. A durable permission failure
  can produce the same pair. Reclassifying or retrying that error is therefore
  rejected as both ambiguous and contrary to the requested no-retry fix.

## Scope and non-goals

In scope:

- Remove the normal-release delete/create collision at the contested
  `auth.lock` namespace.
- Deterministic regression coverage for successor acquisition while the prior
  lock directory is still being cleaned at its non-contested path.
- Preserve the original twelve-manager endpoint-count and result assertions.
- Preserve immediate propagation of unexpected `mkdir` failures, including
  `EPERM`; the fix must make the verified error path unreachable during normal
  release rather than reinterpret it.
- Update durable auth documentation and add a root CLI patch fragment.
- Remove every temporary diagnostic, stress loop, and CI job before completion.

Not in scope:

- Timer changes, added retries/backoff/polling, or weakened assertions.
- Changing process-liveness or stale-owner policy.
- Adding an in-process mutex or a caller serialization constraint.
- Redesigning unobserved stale-owner and old-ownerless recovery paths. Their
  fail-closed empty-directory removal remains unchanged. Under recovery plus
  simultaneous contention they retain a bounded possibility of the same
  Windows `EPERM`; covering them safely requires a moderate expansion of the
  stale-reclamation protocol, while every observed failure used normal release.
- Changing the exceptional cleanup after an unexpected `owner.json` creation
  error. It also removes an empty contested `auth.lock`, but requires the owner
  write to fail outside the already-handled `EEXIST`/`ENOENT` lost races and was
  not entered by any reproduction.
- Bun upgrades or retained diagnostic CI configuration.
- MCP/package/plugin behavior, external issues, merge, release, publish, or
  deployment.

## Architecture and ownership

`LockedAuthStorage` owns cross-process lock lifecycle, including the point at
which an owner relinquishes the shared namespace. It therefore owns selecting
and sequencing the release rename and cleanup. `TokenManager` must remain
unaware of lock internals.

`FileSystemService` owns the raw filesystem rename operation because it is the
existing injected I/O boundary. Adding one `rename(source, destination)` method
keeps the lock protocol deterministic to test and avoids a private, lock-only
filesystem seam. The smaller direct `node:fs/promises` import was rejected
because it would make the handoff operation the only uninjected release I/O.

Normal release will atomically rename the still-owned directory, including its
verified matching `owner.json`, from `auth.lock` to a unique owner-scoped sibling
before deleting either the owner file or the directory. The rename is the unlock
linearization point. A waiter can see the old directory or create a fresh
`auth.lock`; it never competes with deletion of that same pathname. Cleanup then
targets only the renamed directory and cannot remove a successor lock.

The owner-scoped cleanup name is derived from the existing SHA-256 owner hash,
so it is filesystem-safe on Windows and does not expose owner metadata. If the
process exits or cleanup fails after the rename, the renamed directory is inert:
it is not a lock and cannot block future auth work. No scan, queue, second lock,
or recovery state machine is added for that exceptional residue.

Alternative considered: keep the existing delete/create protocol and treat
`EPERM` plus a missing owner as contention. That is smaller in lines but is an
ambiguous retry and leaves the Windows namespace race intact, so it is rejected.
A persistent lock directory with a recreated owner file merely moves the same
Windows unlink/create collision to `owner.json` and is also rejected.

## Assumptions and compatibility

- The verified production failure is the normal `releaseLock()` path. No
  stale-reclaim event appeared in any reproduction.
- Same-parent directory rename is atomic at filesystem namespace granularity on
  supported platforms; the final Windows stress validation must verify Bun's
  concrete behavior under the original contention shape.
- A release rename failure retains the matching live lock and preserves the
  current fail-closed behavior. It is not reclassified or retried.
- Stale-owner and old-ownerless reclamation continue using their existing
  guarded empty-directory deletion. Changing those unobserved recovery paths
  would add protocol surface without evidence from this failure.
- Root `githits` behavior changes; `@githits/mcp` does not because local
  file-backed auth remains a CLI-owned implementation detail.

## Cross-cutting considerations

- Security: no credential contents or absolute auth paths are logged or placed
  in cleanup names. Exact owner verification remains required before release.
- Performance: this is a correctness change, not an optimization. Normal release
  replaces unlink-plus-rmdir at the shared name with one same-parent rename and
  the same cleanup at a private name, so no benchmark is required.
- Compatibility: the lock directory still contains the same `owner.json` while
  held. Older contenders can observe the lock normally; as with the existing
  hardened reclaim protocol, long-running local MCP processes should be restarted
  after upgrading so all releasers use the corrected handoff.
- Failure and rollback: a failed rename leaves the original lock intact and
  reclaimable after process exit. A crash after rename can leave only an inert
  owner-scoped cleanup directory. Reverting the code requires no data migration,
  but restores the normal-release Windows race.
- Operations and documentation: permanent auth documentation will describe the
  unlock point, inert residue, remaining fail-closed recovery behavior, and manual
  cleanup guidance. Temporary diagnostics and CI stress configuration are removed.
- Testing: behavior is covered at the lock boundary with deferred gates, at the
  integration boundary with the unchanged twelve-manager invariant, and on real
  Windows through the draft PR before the diagnostic job is removed.

## Implementation phase

### Phase 1 — Replace normal release deletion with atomic rename-away

Status: IMPLEMENTING.

Expected outcome: the outgoing owner gives up `auth.lock` atomically, and its
subsequent cleanup cannot collide with successor `mkdir(auth.lock)`.

Assumptions: same-parent rename has the required namespace semantics on Bun's
supported Windows runtime; this is verified by retaining the diagnostic stress
shape for one implementation run before removing it.

Unknowns or product decisions: none.

Dependencies: the existing draft PR #346 and its credential-free Windows test
branch; no new dependency or infrastructure.

Detailed implementation:

1. Add `rename(source, destination)` to `FileSystemService`, its production
   implementation, and the central mock factory.
2. Add an owner-scoped release-path helper in `LockedAuthStorage` using the
   existing SHA-256 owner hash and a Windows-safe sibling suffix.
3. After `releaseLock()` re-reads and verifies its exact owner, rename the whole
   lock directory to that release path. Only after the rename succeeds, delete
   `owner.json` from the renamed path and remove that renamed empty directory.
   Preserve current fail-closed behavior if verification or rename fails.
4. Add a deterministic two-storage regression using deferred gates. Block the
   first owner's cleanup only after its rename, let a second storage acquire the
   original `auth.lock`, and assert the critical sections do not overlap and the
   successor completes while old-path cleanup is still blocked. No timers or
   polling are used.
5. Add path coverage with `path.win32` for the owner-scoped release name and keep
   a test proving unexpected lock-directory creation errors propagate. Update
   existing release cleanup tests to assert cleanup targets the renamed path.
6. Restore the original one-copy twelve-manager integration test and remove all
   diagnostic logging, direct PID probes, environment switches, and temporary
   workflow jobs.
7. Update `docs/implementation/auth.md` with the rename-away handoff and its
   inert-cleanup-residue behavior. Add `changes/<unique>.fixed.md` with
   `githits: patch` and `@githits/mcp: none`.
8. Run focused tests, `bun test`, typecheck, formatting/lint, build, CLI/MCP
   smoke suites, built smoke suites, and public-package validation. Temporarily
   retain the already-open draft PR's Windows stress job only long enough to
   validate the final protocol under the original contention shape. Its
   credential-free diagnostics must count release-rename failures explicitly,
   because a fail-closed rename error can surface later as a waiter timeout.
   Then remove the stress job and confirm the normal Windows matrix and all
   required checks pass.

Acceptance criteria:

- Deterministic regression proves a successor uses a fresh `auth.lock` while
  prior cleanup is blocked at a distinct owner-scoped path.
- Normal release never deletes `owner.json` or removes a directory at the
  contested `auth.lock` path.
- Unexpected `mkdir`, owner verification, and release-rename errors remain
  fail-closed and are not retried as contention.
- The unchanged integration test makes one endpoint call and returns the same
  refreshed token to all twelve managers.
- No diagnostic or stress-only code/configuration remains.
- Focused and full local validation plus Windows CI pass.
- Durable documentation and release impact match the final behavior.

## Completion

There is one implementation phase, so no inter-phase reorientation is needed.
After implementation and review, re-read the delta against this plan and
`origin/main`, transfer durable facts to `docs/implementation/auth.md`, delete
this plan, and confirm no unresolved findings or deferred minor work remain.
