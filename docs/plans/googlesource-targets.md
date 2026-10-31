# Public Googlesource repository targets

## Status and outcome

Overall: IN PROGRESS. Plan review clean after two rounds. One implementation
phase, IN PROGRESS. Public Googlesource HTTPS
repository targets reach existing CLI/MCP services, retaining refs, paths,
symbol selectors, and exact HTTPS replay pointers. No product decisions open.

## Verified state

- Clean task branch starts at freshly fetched origin/main `6f937fb` (0.37.0).
- `packages/mcp/src/shared/repository-target.ts` owns recognition, validation,
  normalization and formatting for CLI/MCP. Its allowlist rejects Googlesource.
- Backend PR 3815, merge `ab4e8e9`, defines DNS labels as lowercase alphanumeric
  with internal hyphens (63 bytes per label, 253 total); requires a subdomain of
  googlesource.com; project components match `[A-Za-z0-9._-]+`, excluding empty,
  dot and dot-dot. It strips one trailing slash and terminal `.git`, rejecting
  a residual `.git`. User supplied dev pins and successful package-form evidence.
- Existing parser splits refs before URL parsing, preserving `/` and later `@`.
  Unified list/grep/read forward target strings; search parses repository identity.
  Canonical resolve inputs are deliberately rejected locally as unnecessary.
- No inherited endpoint overrides or API-token environment variable are set.
- Baseline parser/parity run: 418 pass, 0 fail, 842 expectations. New tests
  reproduce five rejected valid Googlesource forms. Dev credential reads currently
  block in macOS Keychain; user has been asked to unlock access securely.

## Scope, ownership and architecture

The existing shared parser owns repository address grammar: extending it covers
all consumers without command-specific parsing. Keep the static provider table
for existing compact providers; select a Googlesource grammar for validated
DNS hosts checked against the raw authority (before URL normalization) and leave its prefix absent, since only full HTTPS forms are public.
Formatter returns canonical HTTPS for that grammar. Normalize `.git` only for
Googlesource. Keep existing provider transport, ports, paths and output unchanged.

Fold host case; preserve project/ref case. Require HTTPS (reject HTTP).
Reject credentials, all ports, queries, fragments, percent-encoded identity,
traversal, empty components, Gitiles `+` routes and suffix lookalikes. Preserve
-review hosts as distinct identities. No aliases, clients, flags, dependencies,
runtime controls, storage, queues, API selection changes or other repository edits.
No merge, release, publication or deployment is authorized.

## Assumptions, unknowns and dependencies

Assumptions: backend grammar at the merged commit is the intended compatibility
contract (verified source and user handoff); dev indexes contain the supplied
Go time/sync commits (user evidence; verify live during this phase).
Unknowns: none for implementation. Live dev authenticated via built Node CLI;
time/sync pins and Express 5.2.1 served successfully; native-v6 attribution is
from the handoff because CLI results do not expose native format versions; these affect evidence, not parser design. Product decisions: none.
Dependencies: installed Bun/Node, existing CLI dev auth, backend dev deployment.
No dependency on backend PR 3818; report its serialization limitation if observed.

## Phase 1 — implement, verify, review and deliver

Expected outcome: HTTPS Googlesource targets work through built CLI resolve,
search, grep, list and read, with unchanged replay and retained provider behavior.
Assumptions/unknowns/dependencies: as above. Status: IN PROGRESS.

1. Add focused positive and negative parser regressions and consumer parity for
   Googlesource full URLs, nested paths, case, `.git`, slash, tag/branch/SHA refs,
   distinct review hosts and HTTPS formatting. Existing provider regressions stay.
2. Extend shared grammar with a small host/path validator and canonical URL output.
3. Update durable repository grammar and CLI search/files/grep/read/diff help where
   provider lists contradict support, including the exhaustive host-rejection
   error in repository-target.ts. Audit resolve_target argument guidance and
   quick_start/public skill parity; their generic supported-URL wording remains
   accurate and need not grow provider lists. Correct the stale HTTPS list in
   skills/githits-code/references/code-and-docs.md only in the next release, as
   required by the public Agent Skill lifecycle; record the exact release action
   in durable docs/backlog and the fragment now. No generated assets change. Add a fragment with minor impacts for both packages,
   matching earlier provider additions.
4. Run focused Bun parser/parity suites, typecheck, build, full unit suite and
   source CLI/MCP smoke against dev. No performance optimization is proposed.
5. Exercise built Node CLI on time `v0.16.0` / `fb013b3d305a26f5ef5350a6eaffc7c87a200383`
   (`rate/rate.go`, `golang.org/x/time/rate.Limiter`) and sync `v0.17.0` /
   `04914c200cb38d4ea960ee6a4c314a028c632991` (`errgroup/errgroup.go`,
   `golang.org/x/sync/errgroup.Group`). Resolve fuzzy names and verify canonical
   inputs need no resolution; search CODE/SYMBOL, grep, list, exact file/symbol
   read and execute emitted HTTPS@8SHA actions unchanged. Retain npm Express native-v6 snapshot
   coverage with the same operations supported by its indexed snapshot. Verify
   code-diff identity/endpoints through existing consumer parity and a bounded
   built-CLI equal-SHA diff; report backend-owned unavailable raw diff explicitly.
6. Run a targeted existing agent:e2e navigation workload for shared MCP behavior;
   inspect tool calls, final answer, metrics and isolation violations. Report any
   unavailable authentication separately from deterministic checks.
7. Internal preflight and one external Claude reviewer per round, fix accepted
   findings, repeat to clean within three rounds. Commit coherent verified delta.
8. Move durable compatibility/live evidence into implementation docs. After clean
   review delete this temporary plan before final push. Push and open draft PR.

Acceptance: parser tests prove exact grammar and existing providers unchanged;
CLI/MCP parity proves identity and target/ref/path preservation; dev operations
return positive expected evidence and pinned commits; replay executes unchanged;
Express compatibility evidence records actual snapshot/version. Build/typecheck,
unit/smoke checks pass or an external blocker is explicitly reported. No secrets
appear in logs or delivery. Reviewed commits and draft PR exist.

## Implementation evidence

- Shared parser change and help/docs complete; focused parser/parity 482 pass.
- Full unit suite: 6,840 pass, 27,726 expectations, 259 files. Typecheck, build,
  format, lint, plugin check, public-package validation all passed.
- Source/built unauthenticated CLI smoke: 33 steps each; MCP registration: seven
  each. Authenticated CLI/MCP smoke hit the same pre-existing Docker recovery
  fixture failure already in the backlog; no assertion was weakened.
- Built Node dev CODE/SYMBOL search, grep, list, full-SHA file read and qualified
  symbol read passed for both supplied Go pins; full-SHA browse and @8SHA read
  actions replayed unchanged. Full-file bytes/digests match list inventory.
- Canonical resolve local rejection is correct; fuzzy resolve still emits the
  known backend-owned internal key pending PR 3818. Equal-SHA time diff passed.
- npm Express 5.2.1 control passed search/list/grep/read at dbac741a. Native-v6
  attribution is supplied backend evidence, not observable via CLI output.
- Existing local/dev code-file-navigation eval completed: four logical MCP calls,
  no detected isolation violations, high self-reported confidence. Raw tool,
  final and metrics artifacts inspected; no graded quality claim.
- Detailed reusable evidence is in docs/implementation/repository-targets.md.
- Code review, final commit/plan cleanup and draft PR remain.

## Plan review closure

Internal preflight: direction sound, no findings. External round 1: direction
sound; accepted raw-authority validation, case/HTTPS wording, minor release
impact and the diff consumer/help audit. The stale code-and-docs HTTPS list needs a release-branch update, not
a feature-branch edit: githits-release/SKILL.md explicitly forbids advertising
unreleased behavior in public skills. Record this release-boundary action now; generic quick_start and resolve_target supported/canonical wording
is not an exhaustive host list and does not require additional provider text.
The bounded sibling scan includes every parser consumer, existing diff parity,
CLI help and canonical public skills. No new mechanisms or product decisions. External round 2 was clean after the
minor wording fix explicitly naming the host-rejection guidance update.

## Cross-cutting considerations and completion

Pure parsing requires no service mocks; parity uses existing injected mock
factories. Existing InvalidArgumentError classes remain; host guidance includes Googlesource. No additional fetched
fields, migrations or operational controls. Rollback is reverting this bounded
parser change. Both shipped artifacts consume it; hosted MCP still requires its
normal separate package adoption/deployment. Documentation lives in
`docs/implementation/repository-targets.md`; help lists are corrected in place.

One phase only; any major boundary/scope change goes to the user before proceeding.
The plan stays through review, then is deleted in the final reviewed delivery;
all reusable facts move to durable docs, deferred major work to the backlog.
