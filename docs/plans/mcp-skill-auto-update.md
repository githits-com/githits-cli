# Proposal: update unchanged MCP skills during local startup

Status: IN PROGRESS — user invoked `$orchestrate` to implement this increment.
Date: 2026-10-01.

## Problem and outcome

Guided `init` installs a snapshot of `githits-mcp`. A later CLI release can
change tools and their matching skill guidance, but starting its local MCP
server leaves that snapshot stale. A loaded skill skips `quick_start`, so this
gap matters even though the server's descriptors are current.

On local MCP startup, replace an existing, demonstrably unchanged MCP skill
with the running CLI's bundled content. Preserve edited and unknown files.
Bootstrap existing installs with verified historical SHA-256 hashes; mark new
installs and upgrades with a checksum so future versions need no growing
historical list. This is one implementation increment.

## Verified current state

- `src/commands/mcp.ts` funnels explicit `mcp start` and non-TTY bare `mcp`
  through `createMcpCommandStartup()`. TTY bare `mcp` shows instructions only;
  help never constructs startup dependencies. No path maintains installed skills.
- `src/commands/init/init.ts` owns skill source resolution and the active and
  historical host/root maps. Selected hosts receive all four packaged skills;
  this proposal updates only `githits-mcp` automatically.
- `src/commands/init/setup-handlers.ts` reads source candidates for source and
  bundled runtimes. `executeSkillSetup()` copies exact source content with
  `atomicWriteFile()`; a differing installed file is overwritten by explicit
  setup. Its configured check currently compares raw source and target strings.
- Canonical local launch is `npx -y githits@latest mcp start`. Cursor and plugin
  or extension installations use hosted MCP and do not execute this command.
- Root npm `files` includes `skills/`; the bundled file is available offline.
  `packages/mcp` must not acquire filesystem discovery or installation behavior.
- The terminal quick-start section in the canonical skill exactly matches
  `buildMcpQuickStart()`, enforced by `src/skills-packaging.test.ts`.
- Read-only npm tarball inspection checked all 43 published versions from
  `0.6.0` through `0.25.0`: 25 distinct exact skill hashes. All available root
  release tags match their tarball content. Earlier local tags have no MCP
  skill. The registry's latest was `0.25.0`, whose hash matches this checkout.
  Historical evidence is recorded in the appendix; registry source:
  <https://registry.npmjs.org/githits>.
- Directory aliases are real: the local Claude skill directory is a symlink,
  and `src/services/filesystem-service.test.ts` already covers a Claude skill
  directory pointing at the shared root. Atomic rename prevents partial files,
  preserves existing permissions, and is not a compare-and-swap operation.
- Existing agent-eval MCP children inherit the caller's home for authentication
  even when the acting agent has a disposable home. Live smoke's
  `createScopedSmokeEnvironment()` also inherits home, isolating only
  XDG_CONFIG_HOME/APPDATA; only its unauthenticated helper isolates home today.
  Both need explicit maintenance isolation before running these suites.

## Scope, assumptions, and decisions

Confirmed scope and recommended defaults:

1. User confirmed: inspect existing user roots and project roots at startup
   `cwd`, deduplicated.
   Do not walk parents, other repositories, or plugin caches. Project guidance
   may be tracked in Git; an eligible update can appear as a working-tree diff.
2. Latest user steering: automatically upgrade only and warn when an older CLI
   has different guidance from a newer installed skill. This handles shared
   roots used by multiple versions. Equal payloads stay silent. Explicit `init`
   remains the operation that intentionally reinstalls bundled content, including
   a pinned version whose tools require different guidance.
3. Refresh from the running package, without fetching `main` or another release.
   A global or pinned CLI stays tied to that version. “Newest” means its bundled
   skill; users receive newer bytes after their launch obtains a newer CLI.
4. Check every supported active root, rather than detecting installed agents or
   guessing the connecting client. Only existing MCP skill files are candidates.
   Shared-root skills can be refreshed by another local client; a remote-only
   installation with no local startup retains its current refresh behavior.
5. Automatic updates preserve files that differ at the final content check.
   The design does not promise transactional exclusion of simultaneous manual
   edits or competing CLI versions; the small read-to-rename race is documented
   below rather than answered with new locks or caller serialization.

User confirmed user/project scope, steered toward forward-only refresh with
older-version warnings, and approved the environment opt-out while requesting
a persistent config opt-out. Open product decisions: none. The remaining
defaults above are explicit proposal assumptions. User subsequently authorized
implementation through `$orchestrate`.

Non-goals: updating the other three skills; creating missing installations;
migrating historical Cline/Junie roots; editing instruction pointers or MCP
config; changing tool behavior or the guide; downloading skills at runtime;
upgrading the CLI itself; modifying hosted MCP, third-party plugin managers,
or generic skill installers. Untagged Git snapshots are not added speculatively
to the legacy list; unknown unmarked content remains untouched.

This is independent of the later Skills-over-MCP transport work in
`mcp-served-githits-skill.md`; it does not supersede that plan.

## Ownership and target architecture

The root CLI owns installed skill lifecycle because it already owns `init`,
host paths, and local startup. A small shared CLI helper should serve `init`
and startup; putting it in `packages/mcp` would impose host filesystem policy
on remote servers, and importing the large `init.ts` from startup would couple
maintenance to detection, login, and prompting.

Extend the existing `src/commands/init/guidance-assets.ts` (or an adjacent
focused asset module) with the existing root/source definitions and source reader,
preserving existing setup path behavior. Add a focused
`src/services/mcp-skill-update.ts` with pure marker/eligibility helpers and a
thin filesystem coordinator. `FileSystemService` is the IO boundary, injected
for tests; extend it and its mock factory narrowly for path resolution and
file-kind checks. A small `src/services/skill-config.ts` reads the typed local
maintenance policy through existing `readAppConfig()`, following the separate
auth/experimental subsection-loader pattern. Reuse `atomicWriteFile()` and the existing `semver` dependency.
No container registration or public package export is needed.

## Disable policy

The root CLI owns this local maintenance policy. Use the existing user
`config.toml` rather than account-backed `githits settings` or a project config
file: it controls writes on this machine and must work without authentication.
Canonical XDG/APPDATA paths and the existing macOS legacy fallback are shared
through `readAppConfig()`; do not add a discovery system.

```toml
[skills]
auto_update = false
```

`skills.auto_update` is a strict boolean, defaulting to `true` when absent.
It currently controls `githits-mcp` maintenance only; other skills do not gain
automatic updates. `GITHITS_DISABLE_SKILL_UPDATE` takes precedence: any non-empty
value disables maintenance, matching `GITHITS_DISABLE_UPDATE_CHECK` convention;
an empty/unset value defers to config. Config `false` disables, while `true`
or absence enables unless the environment disables it. Opt-out skips skill
inspection, writes, and mismatch warnings; explicit init remains available.

Validate this subsection with Zod without rejecting unrelated keys. An invalid
`skills.auto_update` value skips maintenance with a sanitized stderr warning
and does not introduce an MCP startup failure. Preserve existing malformed-TOML
auth/experimental startup errors; this feature does not relax those validators.
If the new policy reader itself raises `AppConfigError`, warn safely and skip
maintenance with no writes; never add a startup failure on paths that previously
skipped TOML parsing (env-token auth plus `--experimental-tools`). Check the env
opt-out before reading policy config.
Do not print TOML contents or validation values. Validate ordinary startup
dependencies before any skill writes, so existing failed startup does not
mutate guidance. This setting uses no new CLI command or backend preference.

```text
Bundled canonical SKILL.md + fixed legacy hash array
                         |
            CLI skill installation helper
                  /                 \
       explicit init                 local MCP startup
       render marker                 inspect existing roots
       install/reinstall             verify unchanged + upgrade
                  \                 /
                 atomic skill replacement
```

Startup enumerates the unique active maps: user `.agents/skills`,
`.claude/skills`, `.kiro/skills`, `.factory/skills`, `.gemini/config/skills`,
and `.hermes/skills`; project `.agents/skills`, `.claude/skills`,
`.kiro/skills`, and `.factory/skills`. Use the shared map, not a second list.
Historical `.cline/skills` and `.junie/skills` remain explicit-init migration
targets. Current custom-environment behavior stays exactly as the init map
defines it; this increment does not independently invent new host paths.

Resolve each enumerated active root, then construct its expected
`githits-mcp/SKILL.md` destination. Accept a candidate only when its resolved
file equals one of these expected destinations. This supports symlinked home
and root directories, including dotfiles repositories that intentionally own
those roots. Directory/file aliases to another active destination share one
resolved target and preserve their links. Skip skill aliases that escape the
resolved active roots (such as links to a separate source checkout or package
cache), and skip non-regular targets. Deduplicate resolved destinations, with
real Windows path semantics in tests.

## Installed checksum contract

Keep the authored/package skill byte-for-byte unchanged. Add one installation
comment immediately after its closing YAML-frontmatter delimiter:

```markdown
<!-- githits-managed-skill v1 version=0.26.0 sha256=<64 lowercase hex characters> -->
```

The version above is illustrative, not a proposed release bump. It is the
writing CLI package version. SHA-256 covers the entire canonical UTF-8 file,
including frontmatter, whitespace, and final newline, excluding only this
exact inserted comment line and its newline. Removing a valid marker must
recover the original file exactly. Do not normalize line endings, strip a BOM,
trim prose, rewrite YAML, or remove arbitrary comments.

Recognize exactly one supported marker at that position. A malformed,
duplicated, misplaced, or unsupported reserved marker is not legacy content:
preserve it. For a valid marker, first recompute the payload checksum; if it
mismatches, preserve the file, even when its payload resembles a known version.
The marker is evidence of accidental edits, not a signature or authorization
boundary against someone deliberately recomputing it.

| Existing file | Startup action |
|---|---|
| Missing | No-op; do not create directories/files |
| Unmarked, exact bundled bytes | No-op; preserve byte-identical current content |
| Unmarked, recognized historical hash, different bundled bytes | Upgrade to bundled bytes plus marker |
| Unmarked, unknown bytes | Preserve |
| Marker invalid or checksum mismatch | Preserve |
| Valid checksum, same payload as bundled | No-op |
| Valid checksum, different payload, older writing CLI version | Upgrade plus fresh marker |
| Valid checksum, different payload, same writing CLI version | Preserve |
| Valid checksum, different payload, newer writing CLI version | Preserve; warn about the older running CLI |
| Read/write/source error | Warn safely on stderr and continue MCP startup |

Store historical SHA-256 hashes as a small readonly string array, with release
provenance in comments or fixtures. They are all pre-feature releases, so every
released CLI containing this updater is newer; no historical version comparison
is needed. The 25 historical hashes are a one-time bridge. Future `init` installs and
startup upgrades carry their own checksum, so normal releases do not append
hashes. If another unmarked release ships before this feature, add its verified
tarball hash before delivery. No runtime npm request or history lookup exists.

`init` renders the same marker for `githits-mcp` only. Its configured check and
setup early return recognize a valid checksum plus identical stripped payload,
ignoring the marker's writing version. A CLI upgrade with unchanged guide bytes
therefore remains configured and writes nothing; share this predicate with
startup. Explicit init can add the marker to a current unmarked installation.
Keep its existing explicit overwrite policy and setup result envelopes.
Other skills and their references retain existing behavior. Generic/plugin
installs continue to carry canonical unmarked content; future unrecognized
copies from those routes are preserved, not silently enrolled.

## Startup, failure, and session behavior

Run maintenance once in the CLI startup factory before server connection,
covering explicit start and bare non-TTY MCP. Do not add it to exported
`startMcpServer()`, which accepts services and should remain a transport helper.
Help and TTY instructions remain read-only.

Read the bundled skill once, then check existing candidates. Immediately before
each replacement, reread the resolved file and require the inspected bytes to
be unchanged; otherwise preserve it for this launch. Replace with the existing
atomic helper. Permission or missing-source failures must not prevent server
connection, and one failed target must not prevent another eligible update.
Successful updates, missing files, edited/unknown files, and identical payloads
are silent. For a valid newer-version marker with different payload, emit a
short warning naming the running and writing CLI versions; explain that this
shared skill was preserved and intentional version-specific reinstall uses
`init`. Emit a short sanitized warning for IO failures; never print content,
environment values, or raw exceptions. Stdout stays exclusively MCP protocol output. No prompts,
background tasks, retry loops, backup tree, or new lock are required.

Atomic replacement avoids truncated skills. It cannot exclude an editor write
after the final reread, or make simultaneous different-version launches globally
ordered. Ordinary repeated same-version starts are idempotent. Do not claim
stronger concurrent-edit or no-downgrade guarantees than these checks provide.
New infrastructure to eliminate that residual race would need a separate user
decision. This is a documented compatibility limit, not a deferred fix.

The file is refreshed before the local server connects. Hosts may have loaded
skill content earlier in their session; this does not hot-reload agent context.
Fresh sessions can use the new file. Do not advertise that every already-open
chat receives the new guide immediately.

Rollback: disabling/reverting the startup hook stops automatic writes. Restore
content intentionally with a chosen CLI's `init`; startup itself never performs
automatic downgrades. Older CLI init code can overwrite/remove the marker when
explicitly rerun, after which only recognized historical bytes can be migrated.

## Phase 1 — unchanged installed MCP guidance follows local CLI upgrades

Status: IN PROGRESS — implementation and verification underway.

Expected outcome: local users get matching bundled MCP guidance on subsequent
startups without rerunning init; existing customization survives the eligibility
check. New installs and upgrades can be refreshed by later releases without
extending the historical hash list.

Assumptions: the five scope/default assumptions above. Dependencies: existing
root filesystem service, packaged skills, init root map, `semver`, and command
startup factory and shared local TOML reader. Unknowns/product decisions: none.

Ordered implementation:

1. Extract shared root/source ownership without changing init targets. Add the
   proven historical array and provenance fixture; no network in normal tests.
2. Test and implement marker round-tripping, SHA-256 eligibility, version
   ordering, and filesystem maintenance with injected dependencies.
3. Render the installed MCP marker in setup and configured checks. Preserve
   setup/uninstall reporting and other skill behavior.
4. Add the strict typed config reader and approved env/config disable policy.
   Integrate once into CLI startup after ordinary dependency validation, keeping
   maintenance failure non-fatal and stdout clean. Accept injected env/config/IO
   dependencies in tests; do not read process-global policy in pure helpers.
5. Make smoke/eval MCP startup isolation safe before launching either suite.
   For scoped/live smoke, explicitly set HOME/USERPROFILE to its disposable root
   and launch MCP from a disposable cwd with an absolute CLI entry. Preserve
   inherited env-token auth; this path already isolates file-auth config and
   needs no opt-out. Regression tests must cover this previously inherited home.
   Where a live eval intentionally needs the caller's authentication home, set
   `GITHITS_DISABLE_SKILL_UPDATE=1` for that child. Document this narrowly scoped
   maintenance opt-out; match existing `GITHITS_DISABLE_UPDATE_CHECK` truthiness
   (any non-empty value disables). Add the variable to the eval MCP-child env
   allowlist and its Codex wiring; do not assume the child inherits it. Do not
   copy credentials or redesign auth. Direct startup
   tests and isolated smoke still exercise the enabled updater. This flag also
   lets operators preserve pinned guidance deliberately. Do not simply
   keep the caller's auth files through XDG_CONFIG_HOME with a different home:
   auth locks use `HOME/.githits`, so that splits locks for the same auth store.
6. Update `docs/implementation/agent-onboarding-skill.md`,
   `docs/implementation/plugin-packaging.md`, `docs/implementation/config.md`
   (including env table and TOML setting), and release lifecycle docs
   with ownership, byte contract, scope, preservation, opt-out, and session
   limitations. Add a fragment with pending `githits: minor` and
   `@githits/mcp: none`: CLI installation behavior changes, public MCP APIs and
   tool/guide bytes do not. Do not edit public onboarding prose prematurely.
7. Verify, review, and deliver one draft PR. No merge/release/deploy authorization
   is implied. After a clean final implementation review, transfer durable
   knowledge and delete this plan in the PR's final commit.

Acceptance criteria and verification:

- Every recognized historical payload that differs from bundled content
  upgrades; identical payloads remain byte-identical. A one-byte/whitespace/
  line-ending edit stays untouched. Checksum-marked payloads from a synthetic future version
  migrate without appearing in the historical list. Invalid markers, edited
  marked payloads, and same/newer different payloads are preserved.
- Current unmarked installs remain byte-identical; a repeated enabled startup
  performs no writes. Missing files remain missing. Shared aliases update once
  and keep links; symlinked home/root paths work, while escaping skill aliases
  and non-regular files remain untouched.
- User/project scope matches the extracted map, including Windows path tests.
  Final-reread changes preserve the file. Permission/source failures remain
  non-fatal, stdout stays clean, and other roots still update.
- Explicit init installs a valid marker and repeated detection reports it
  configured, including across a payload-unchanged CLI-version upgrade without
  a marker-only rewrite. Other skills are byte-identical to previous install behavior;
  uninstall still removes only its existing owned targets.
- Policy tests cover missing config, true/false, invalid setting types, unrelated
  keys, canonical/legacy paths, env precedence and empty/non-empty env values;
  include maintenance config-read failure under env-token/experimental startup.
  Disabled maintenance reads/writes no skill files; explicit init still works.
- Command tests cover both local startup routes, help/TTY no-op, both opt-outs,
  older/different-guidance stderr warning (same payload silent), and failure
  followed by successful connection. All tests use injected temporary
  home/cwd and never modify the developer's installed skills.
- Run the focused updater, init handlers/init, filesystem, MCP command, and
  packaging tests with `bun test`; then repository `bun test`, typecheck,
  formatting, lint, `bun run build`, plugin generation/check and public-package
  validation. Verify source and built CLI resolution from a temporary consumer
  cwd outside repository aliases, with an old skill fixture.
- Run `bun run smoke:cli` and `bun run smoke:mcp` with isolated maintenance
  targets. Since startup isolation/validation wiring changes, also run
  `bun run smoke:cli:built` and `bun run smoke:mcp:built` after build; assert
  upgrade fixtures and protocol/auth handling rather than network-dependent
  answer content.
- Target the existing `express-router.md` full-guidance local MCP workload
  through `bun run agent:e2e` for Codex and Claude when available. Confirm skill
  loading, no redundant `quick_start`, real tool use, neutral final confidence,
  metrics, and isolation violations from artifacts. The eval's opt-out protects
  caller guidance; deterministic startup tests prove file updating. No answer
  quality claim without grading. No benchmark is needed: this fixes lifecycle
  behavior and proposes no performance optimization.

## Review and completion

### Orchestration slices

One Luna implementor returns verified, uncommitted work for each bounded slice;
the coordinator owns commits and integration. Live sandbox: full access, no
approval prompts. Workers must keep to their file ownership and never inspect
credentials or modify installed guidance outside temporary test roots.

Sequence, dispatched one slice at a time:

1. Luna: typed `skills.auto_update` config loader and its isolated tests.
2. Luna: extract shared existing skill root/source definitions and source reader,
   preserving init behavior; prove existing setup-path tests still pass.
3. Luna: filesystem path-resolution/file-kind primitives and mock-factory tests.
4. Luna: isolate scoped smoke HOME/USERPROFILE, with the existing environment tests.
5. Luna: make smoke launch entry and MCP cwd independent of the repository cwd,
   with source/built launch tests.
6. Luna: wire the approved maintenance opt-out into eval MCP-child environments,
   proving env forwarding in the existing eval tests.
7. Luna: durable implementation documentation and the independent release fragment
   after verified implementation contracts are settled.

Coordinator: managed-content parsing/hash/version decisions, historical hash
provenance, update eligibility, resolved-destination coordination/final reread,
init marker integration, startup hook and regression tests, live verification,
review adjudication, delivery, and plan retirement. Installed-content helpers
own the checksum grammar shared by init and startup; the updater owns IO and
the typed config loader owns local policy.

Internal pre-flight: direction sound; accepted its missing flag-approval
dependency, later resolved by the user. External Claude round 1: direction
sound; accepted five plan findings (avoid current-content writes, isolate live
smoke homes, resolve alias roots explicitly, ignore marker version for init
idempotence, and simplify the legacy list to hashes). Applied associated
documentation/env-wiring clarifications. Internal closure checks accepted one
historical-equality wording fix and found no issues in the user-requested config
and warning additions. External round 2: direction sound; clean after applying
one minor clarification of the existing non-fatal maintenance error rule for
`AppConfigError`. Verified its env-token/experimental bypass in `container.ts`
and `mcp.ts`; retained ordinary auth/experimental startup errors. No unresolved
findings or open product decisions.
Runtime validation has not run because this proposal changes no production code.

This single increment has no later phase requiring reorientation. Recheck
current main, released hashes, and defaults before implementation. Keep the
plan through implementation review; remove it only after that review is clean,
with durable facts moved to implementation docs and any genuinely open deferred
work recorded in `docs/plans/open-backlog.md`.

## Appendix: verified unmarked release hashes

SHA-256 of exact `package/skills/githits-mcp/SKILL.md` bytes from published npm
tarballs. Multiple versions with identical content share one entry. These are
content fingerprints, not secrets or authentication tokens.

| First release | Identical published versions | SHA-256 |
|---|---|---|
| 0.6.0 | 0.6.0, 0.6.1 | `40f12304586e1653ad6c448fe8c01eaed3182d6f8f0f4ec6f831ff67701b4c09` |
| 0.6.2 | 0.6.2, 0.6.3 | `0a3c5f6d872f48de33e096feb1ad96b391886dedc7df0ece01f1c3796b68ce51` |
| 0.6.4 | 0.6.4, 0.6.5, 0.6.6, 0.6.7, 0.7.0, 0.8.0, 0.9.0, 0.9.1, 0.9.2 | `78ac26c38b93e2d103afeeaf61139627716e34adc85d7268e1bd5e95d46e7676` |
| 0.9.3 | 0.9.3, 0.10.0 | `7067a1d036a5a1936597d692dcdb812bc0200065052f9c55d5f9a726c94b26ce` |
| 0.10.1 | 0.10.1, 0.10.2 | `66b96026d5b9d306acfbff477f402796350314665639afd8f7cc538c09044966` |
| 0.11.0 | 0.11.0, 0.11.1 | `db433299622c17de2a3676f9e9b0c947b1e522c15868678cd3c32b7c5406fc6f` |
| 0.11.2 | 0.11.2 | `141f67e3961d0fa7874e85b155b364cf1603e1d6e8e3cd695b054cf0483004c7` |
| 0.11.3 | 0.11.3 | `c8b520d443826e297f39e0cdea153402d10b1c493c7d6f8bc476e037c4862768` |
| 0.11.4 | 0.11.4 | `cefd8a689f3f8fb5620f1283765e5cd6f802b813ec91c0dfcbb9572c3453a28c` |
| 0.11.5 | 0.11.5, 0.12.0 | `43b81105d2250016d5b407293ca2c4276a4bf399e3dda934c7a4d3776f9b78c0` |
| 0.12.1 | 0.12.1 | `628ac1edcda69f4ccc7be603ee01d642abb9921411c12133c3172c9a34a33935` |
| 0.13.0 | 0.13.0, 0.14.0 | `1693147272dff1a03fc64ad657fe50c53fa1a1b2702bc9fdf887450e957dfe5d` |
| 0.15.0 | 0.15.0, 0.15.1 | `c5eda07eb503f3a540278300da1f8f153fb133a58b71344a4440bba0da08d949` |
| 0.16.0 | 0.16.0 | `6f5d884cf35b9826bc39bbcd3876cd5981c656eb46540bcaa55b0cc36618e182` |
| 0.16.1 | 0.16.1 | `cc2eb35bef19e8c6644921188ee4667f5b1488a7a3994bb518bd38f2e62a4a50` |
| 0.16.2 | 0.16.2 | `3a8d061453d03801fd04fdcf931558d3844d21928771854a7bb6b437984a81fb` |
| 0.17.0 | 0.17.0, 0.17.1 | `643f37705b895ef6a67cb4515787691eabc2d686bd67ac7197c7530db3e061a3` |
| 0.18.0 | 0.18.0 | `92e454f985b14b575ec98b6dfba8ce33e2724ced9a8daa7af5cd314c266aa149` |
| 0.19.0 | 0.19.0 | `882f78f365b4280b8ce1f4fd73f10386adabd9ba9efef9a5f5a21c4f54b40251` |
| 0.20.0 | 0.20.0 | `e1ff987be9212714e059d6256017fe6c3b5fac83ff5a292d6dee55c461679b71` |
| 0.21.0 | 0.21.0 | `40dd93812e31fb2052aa7499e45435230d9aa1a06cc4a64c2bbec3682bdd3d60` |
| 0.22.0 | 0.22.0 | `cc614bae46baaaaebd99798c249ccc551189fc23d86fda1f385783f985cb9d2b` |
| 0.22.1 | 0.22.1, 0.23.0 | `ec14d75d897fd629cc011d6196c868c2833f25b95eebb5238d47bd0ccaf26040` |
| 0.24.0 | 0.24.0 | `32aa1e29c35bd7a1fc1cc25b2e004f78cadbffd2c0e6b0c7d2d0768ea674944f` |
| 0.25.0 | 0.25.0 | `9888ccd1409e48ef60198024f11ded61ec756296eff59a99097901573ec875fd` |

### Implementation checkpoints

- Luna config slice: 9 targeted tests passed; strict boolean/default and safe-error contract verified.
- Luna asset extraction: 72 selected existing guidance/skill tests passed; coordinator inspected exact source/root moves and ran 40 asset/content tests.
- Luna filesystem slice: 12 named tests passed; canonical aliases, file kind, missing paths and mock defaults verified. Coordinator inspected the diff.
- Coordinator core/integration: 526 tests across marker/history/updater/config/filesystem/init/startup/packaging passed. Added startup opt-out/newer-warning cases subsequently: startup plus smoke environment tests 42 passed.
- Luna smoke environment slice: 3 named cases passed, 49 assertions; disposable HOME/USERPROFILE, enabled maintenance, env-token/dev preservation and unchanged caller environment verified.
- Initial typecheck found an overly narrow literal tuple in the hash-list test matcher. The fixed historical array now has the explicit public type `readonly string[]`; no behavior changed. Final typecheck remains pending.

No benchmark: this increment changes lifecycle correctness and makes no optimization claim.

- Luna source/cwd slice: 89 launch/smoke cases passed, including a real absolute-source `--version` child outside the repo. Coordinator reran launch/smoke/updater: 107 passed. Final typecheck caught unchecked tuple indexing in its test; one bounded correction dispatch used the proven local string, then typecheck passed.
- Luna eval slice: 29 selected configuration cases passed, proving forced opt-out across local/published and Codex config wiring. Coordinator inspected actual two-file diff and ran complete eval/harness coverage: 237 passed; typecheck passed.
- Coordinator smoke integration adds real historical upgrade and edited-preservation fixtures to disposable MCP unauthenticated/registration launches, for both source and built runtime checks. Verification pending final documentation slice.

- Luna durable docs slice: contract-presence and scoped diff checks passed; the root CLI init doc owns detailed lifecycle while onboarding/packaging/config/release/eval docs link or state their local contracts. Documentation required a continuation after worker compaction.
- Final repository unit suite: `bun test` passed 5,222 tests, 19,745 assertions across 228 files. Typecheck and format check passed; plugin generation/check passed with no generated changes. `bun run validate:packages` passed (includes root `bun run build`, MCP build, packed artifact scans and outside-workspace consumers).
- Lint exited zero but exposed one extraction-unused import and new template-literal style infos. These minor in-scope findings are being removed before review; existing unrelated diagnostics remain out of scope.

- Final minor cleanup: extraction type import removed by Luna; new template-literal style infos fixed mechanically. Narrow content/updater/assets rerun passed 58 tests. Full lint exited zero with 9 existing warnings and 3 infos; the expanded output revealed two new template-literal infos in init tests, corrected before review. Final scoped lint has no diagnostics.
- `bun run smoke:cli` and `bun run smoke:mcp` passed with dev endpoints and disposable file-auth roots; live queries correctly skipped with AUTH_REQUIRED. Built CLI and MCP smoke modes passed under Node; both MCP paths prove exact legacy update and edited preservation from a temporary consumer cwd. No developer skill roots were inspected or changed by verification.
- Targeted full-guidance local MCP Express router workloads launched for Codex and Claude against dev; results pending. Final implementation review and draft PR remain pending.

- Codex targeted eval: success/high final confidence, 6 completed logical MCP calls (search/list/read), 0 failed calls and no quick_start; full guidance was installed. Metrics and final answer inspected; no grading/quality claim. No isolation-violations artifact was emitted, indicating no recorded violations in this runner.
- Claude attempted the same workload: harness process exit 0 is not workload success. Workload exit 1 before tools/final, with authentication_failed from the CLI; cannot supply qualitative Claude evidence. No credentials inspected or printed.
