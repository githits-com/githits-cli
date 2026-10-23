# Plan: Hosted MCP installation through init

## Current approved revision: connection choice, guidance selector, CLI setup

Status: IMPLEMENTING (2026-10-23). Governing baseline:7b16d5b,
PR505. Delivery is a stacked draft PR from child worktree init-setup-ux
(branch jlitola/init-setup-ux), based on jlitola/feat-remote-mcp-init.
The parent PR remains unchanged. This section supersedes the historical five-choice menus and printed
CLI-skills handoff below. The user approved this behavioral revision and asked
for an explanatory selector, not a Y/n confirmation. It is a new user-requested
scope, not another fix round of the earlier implementation review.

Outcome: the first menu chooses how the agent uses GitHits; MCP guidance is a
separate explicit decision. Direct CLI use installs its supporting skills and
offers sign-in instead of just printing commands. No product decisions remain.

Verified baseline at 7b16d5b: init.ts offered five choices; skill-only exited through
printSkillsInstructions(). Guidance consent exists only for project MCP and uses
confirm(); its decline path already recomputes selection. Both guidance flags
are undefined when absent (verified Commander opts), so explicit consent can
skip another prompt. scanSingleAgent() contains availability detection before
MCP checks. getGuidanceSkillSetups() resolves canonical source/native targets;
executeCompositeSetup()/isSetupAlreadyConfigured() and runInitAuthentication()
already own skill writes/verification and login recovery. CLI code/package
skills explicitly support an installed binary or npx; no global npm install is
required. The four-skill local MCP bundle remains unchanged.

Ownership: the agent catalog owns availability detection; expose that existing
stage for both MCP scanning and CLI setup, preserving command context. Init owns
route choice, consent, review, skills selection and auth. Reuse existing setup
primitives. Do not make CLI setup depend on MCP status or introduce a new
transport profile, service, flags, infrastructure or shared-home framework.

### Phase A — implement the approved flow (COMPLETE)

Dependencies: this design review; existing feature branch. Assumptions: CLI route
means supporting skills plus normal npx-capable CLI auth, not a permanent global
binary installation. Existing MCP connections and unrelated guidance remain.
Unknowns/product decisions: none. Current measured revision: 430 changed
production lines against 7b16d5b. The parent PR has 1570 changed production
lines; combining the changes would exceed the roughly 2000-line ceiling.
The user approved separate stacked delivery. Measure this revision independently.

1. First menu keeps remote default and offers exactly:
   - Connect via remote MCP (recommended)
   - Run MCP locally (supports experimental features)
   - Use the CLI with supporting skills
   - Exit
   The obsolete MCP-only first-menu choice disappears. Existing internal route
   values may remain; remove obsolete plain-MCP intent branching. Explicit
   --remote/--local bypass the route menu. --yes/staged/JSON contracts and
   preserve-on-rerun remain unchanged. --no-guidance does not change the
   interactive remote default.
2. For MCP, choose scope and agents, then use select() before final review:
   prompt "Install supporting skills and instructions?"; default install.
   - Install skills and instructions (recommended): explains when/how guidance
     helps, and that files are added for selected agents. Project-scope text
     explicitly says files are written into this repository and may be committed.
   - Configure MCP only: explains that no skills/instruction files are added.
   Descriptions use deliberate short lines for80-column terminals. Apply this
   to both user/project scopes, replacing the project confirm. Only ask if a
   selected target supports guidance and options.guidance is undefined and the
   run is interactive, not --yes. Explicit flags express consent. Recompute
   selection after decline; guidance-only decline exits without auth/writes.
   No prompt for empty selection, fully configured no-op, manual-only Desktop
   or hosts without verified guidance targets. Before this decision, tool rows
   must not promise that supporting instructions will be installed.
3. CLI route continues through scope and native agent selection, using only
   host availability detection, never MCP config/status probes. Only agents
   with verified skill destinations at that scope are offered. Project CLI
   support follows skill targets, not MCP project-support restrictions.
   Review selected agents and exact deduplicated skill paths before writes;
   explain that skills use the CLI/npx and retain existing MCP settings.
   Install only canonical githits-code and githits-package, including their
   references/code-and-docs.md and references/package.md. Declare all catalog
   skill files, including onboarding references/troubleshooting.md, and test
   metadata against the actual packaged skill tree. Existing init copies
   only SKILL.md; add each skill's reference files to canonical source metadata
   and emit ordinary per-file SkillSetup entries for copy/verification/removal.
   This fixes the local MCP bundle too. Reference files precede SKILL.md so
   existing deleteDirIfEmpty removes empty reference/skill directories. Shared
   target labels and isolated source fixtures must cover all packaged files.
   Do not add recursive deletion or a second installer. Do not add MCP or
   onboarding skills, MCP-first instruction blocks, or remove existing files.
   Skills are integral to the selected CLI route, so no second consent selector.
   An explicit --no-guidance plus CLI-with-skills selection is rejected clearly
   immediately after choosing CLI, before scope selection or scanning; it is a
   contradictory request, with exitCode1 and no auth/writes. Preserve scope flags.
4. CLI setup reuses existing sign-in and recovery (including skip-login,
   no-browser, auth cancellation, already-authenticated and continue-without-
   auth). Auth cancellation precedes writes. Write/verify skills through the
   existing composite setup functions; report failed paths and exit nonzero
   on write/verification failure. No Ready claim without authenticated CLI and
   verified skills. If selected skills already verify, skip install review and
   writes but STILL check/recover CLI auth: an unchanged skills install does not
   establish sign-in. Test this with expired/missing auth. Empty/no supported
   selection exits without login/writes. If no supported agent is detected,
   retain manual npx skills add (code/package selection) and CLI login next steps.
   Shared skill roots are deduplicated and their existing disclosure retained.
   Reused auth start/recovery/explanation copy must be route-neutral (finish
   setup, sign in later; never claim MCP setup on CLI). Make shared scope and
   trust-review wording apply to both routes; CLI has its own skill-load/login
   next steps, never the MCP next-steps printer. No route flag threaded through
   auth helpers when neutral wording suffices.
   Do not delete historical or MCP guidance merely to choose CLI use.
5. Keep route orchestration in init.ts, next to existing flow/auth/guidance
   helpers. Reuse getGuidanceSkillSetups with an optional explicit skill-name
   list for CLI; MCP callers retain per-agent profile-derived selection. Do not
   duplicate target/dedup loops. CLI bypasses buildGuidanceSetupConfig and
   installGuidance, which add MCP-first blocks and remove historical skills.
   Expose a small availability result from the existing detection
   block in agent-definitions.ts without duplicating or moving the block.
   Documentation and canonical inputs only; no generated files hand-edited,
   public skills edited or package versions bumped. Add CLI-only minor fragment
   (MCP none), keep the parent feature fragment unchanged and update release-prep
   onboarding backlog to include these final choices/consent semantics. Delete
   printSkillsInstructions. Update INIT_DESCRIPTION in init.ts, README menu
   table and docs/implementation/init-guidance-and-expanded-agent-support.md.

Acceptance/evidence (new tests prove these distinct boundaries, using small
existing in-memory fixtures rather than another host matrix):
- First menu four choices, remote default; no-guidance can select remote MCP.
- User/project selector install/decline/cancel; no-op/manual/unsupported cases
  and explicit-guidance/no-guidance/--yes skip it; staged contracts unchanged.
- CLI user/project install exact two skills WITH their referenced files,
  deduplicate shared roots, preserve
  existing MCP and unrelated files, never run any MCP probe/add/remove command.
- Local MCP bundle also installs/verifies/removes CLI reference files; missing
  referenced file is a guidance repair. Removal ordering leaves no empty skill
  directories. Existing scope/shared-root protections are retained: CLI-only
  state with no MCP config is cleaned by uninstall; when other MCP config
  exists, unselected/not-MCP-configured host guidance remains protected. Test
  both cases and document the existing mixed-state protection, not a new
  ownership/uninstall framework. CLI output must make no MCP-ready/setup
  claims except its explicit existing-MCP-preservation disclosure.
- Binary/path/hybrid availability and command context retain prior scan behavior.
- CLI auth skipped/cancelled/already-authenticated, write/verification failure,
  unchanged repeat, unsupported/no selection and contradictory flag covered.
- Update old project-consent test to use selector decline, not confirm false.
- bun test src/commands/init/{agent-definitions,init,remote-init}.test.ts plus
  focused new CLI setup tests; typecheck, full bun test with Python3.13 and
  CI's verified Bun1.4.3; build; plugins generate/check; required CLI/MCP smoke
  (file auth unauthenticated contract, do not claim live auth coverage).
- Built Node80-column PTY checks both selector descriptions, MCP-only decline,
  CLI skills install in disposable scope and no writes after cancellation.
  Targeted agent skills-surface code/package canaries where dedicated agent
  credentials are available; inspect actual CLI/MCP traces and isolation, do
  not claim answer quality without grading. No production writes or secrets.

Actual delegation: A1 migrated packaged-file fixtures and catalog contract
(accepted); A2 added guidance selector write-boundary tests (accepted). An
early A2 return after context compaction made no edits; its resumed brief was
narrowed to guidance consent. The coordinator keeps availability extraction,
route/auth decisions, CLI integration tests, existing expectation updates and
durable documentation. No A3/A4 dispatch is needed after that work was done
inline.

### Phase B — review and deliver this revision (IN PROGRESS)

Dependencies: Phase A. Outcome: verified revision committed/pushed to a second stacked draft PR,
CI green and all review findings adjudicated. Assumptions: no merge/release is
authorized. Unknowns/product decisions: none. Internal plan technical pass then
one external plan review before implementation; one bounded Luna preflight and
internal code pass then external implementation rounds on this new revision,
maximum three, no reviewer fanout. Prior review findings/rejections remain in
force; do not re-open them without new evidence. Retain the PR reviewer for
follow-up until human merge approval. Transfer durable contracts into docs and
backlog; retire this plan in this PR as a final commit only after review is clean.

## Prior plan review closure

Selector/CLI revision plan review round1 closure (2026-10-21): direction sound.
Accepted five notes: (1) unchanged CLI skills must still check/recover auth;
explicitly avoid an MCP-style early no-op (test missing/expired auth), (2) reuse
existing skill resolver with an explicit CLI name list and bypass MCP guidance
factory/migration, (3) reject contradictory --no-guidance immediately at route
choice, before scope/scan, (4) delete printSkillsInstructions and name help/
README/durable menu surfaces, (5) retain project/repository/commit disclosure in
selector description. No production or test command ran in plan review. Bounded
sibling scan covered all init guidance/setup helpers, auth early returns,
source/native roots and both menu/help documentation surfaces. Internal plan
pass was clean before this external round; closure sent back before round2.


Selector/CLI revision plan round2 closure: direction sound. Accepted F1: real
code/package skills reference files absent from the current single-file init
installer (verified local skill links and source tree). Add canonical file
metadata and ordinary per-file setup/verification/uninstall, references before
SKILL.md; also fix the existing local bundle. Accepted F2: shared auth/recovery
and review/scope copy currently claims MCP setup; use neutral copy instead of
threading a new route flag through auth, plus CLI-specific next steps. Accepted
F3: regress CLI-only uninstall and document the already-approved mixed-state
shared-root protection. Do not change the established selected/unselected
ownership contract or introduce ownership state. Full review report retained at
/private/tmp/claude-501/-Users-jpl-orca-workspaces-githits-cli-mussel/445cde7f-22f8-4ea6-81a6-698829a5dbb3/scratchpad/selector-plan-review-r2.md.
R2 ran no test commands; external source check confirmed old skills installer
copies full directories, but local missing-reference evidence is sufficient.
Third plan round is the limit; no fourth. Separate stacked delivery keeps this revision below the production ceiling;
measure the revision against 7b16d5b.


Selector/CLI revision plan round3 closure: direction sound; no clean external
plan round at the three-round limit. All final small notes accepted/verified:
include onboarding references/troubleshooting.md as well as both CLI reference
files; canonical metadata test must cover the whole packaged skill tree. Keep
manual skills-install/login next steps for no supported/detected CLI host.
Contradictory CLI/no-guidance choice exits1 before scope/scan/auth/writes.
No fourth plan round. Earlier findings are resolved; no open product/major
architecture decisions. Proceed to implementation under the explicit user's
approval. Last plan reviewer dispatch ctx_c397bb78b60e was released and closed;
existing PR code reviewer remains retained until new code review or approval.


## Implementation verification (2026-10-23)

- Governing child branch jlitola/init-setup-ux; base 7b16d5b. Parent PR505 is
  unchanged. Production delta currently 430 changed lines across 3 files.
- Bun1.4.3 `bun test src/commands/init`: 737 pass, 0 fail, 2928 assertions.
- Full `PATH="/opt/homebrew/opt/python@3.13/libexec/bin:$PATH" bun test` with
  Bun1.4.3: 6691 pass, 0 fail, 253 files, 26911 assertions.
- `bun run typecheck`, `bun run build`, `bun run plugins:generate` and
  `bun run plugins:check` passed; 10 generated assets unchanged.
- `GITHITS_AUTH_STORAGE=file bun run smoke:cli` and `smoke:mcp` passed their
  unauthenticated contracts; live cases skipped AUTH_REQUIRED. Built Node
  `bun run smoke:cli:built` and `smoke:mcp:built` passed (stable unauthenticated
  CLI plus stable/legacy MCP registration). No authenticated live coverage.
- Built Node24.15.0 at 80 columns, disposable HOME/project/PATH with Cline:
  MCP-only added only Cline's HTTP config; consent cancellation added no setup
  files; CLI skip-login added exactly two SKILL.md plus two reference files,
  no Ready claim. Both selector descriptions and opt-in local description
  rendered without splitting words. Artifacts /tmp/githits-init-ux-*.txt;
  script /tmp/githits-init-ux-pty.py. The normal update-check cache is excluded
  from setup-file assertions. Initial attempts detected extra host binaries,
  then a Node shim needed the actual Node executable; isolation was corrected.
- Targeted `bun run agent:e2e --agent <claude|codex> --surface skills --server
  local --workload eval/agentic/workloads/express-router.md --workload
  eval/agentic/workloads/package-overview-vulnerabilities.md --timeout 300`
  attempted both agents using dedicated credentials (no secrets printed).
  Claude2.1.309 returned weekly-limit errors before tools. Codex0.164.0 Luna
  completed neutral answers but express-router made no GitHits call; package
  tried pkg_info, failed auth, and used fallback evidence. Thus successful
  authenticated skill use and answer quality are NOT established. Inspected
  metrics.json, tool-calls.json and final.json; no isolation-violations.json
  artifacts were produced. Harness installs all four existing skills, not the
  exact CLI subset; deterministic tests and PTY establish the installed subset.
  Artifacts .agent-eval/init-ux-skills-{claude,codex}; no harness changes.
- Public skills remain unchanged per release lifecycle; release-prep backlog
  records the final onboarding flow. Two CLI-only fragments: minor UX/setup,
  patch complete reference files; MCP none. No versions or CHANGELOG changed.


Fresh Luna pre-flight: conformance/interfaces sound; accepted one stale durable
onboarding-doc statement claiming every guided route installs four skills.
Updated agent-onboarding-skill.md to route-specific sets and reference files;
bounded sibling scan covered README, cli-commands, plugin-packaging and init
implementation docs. Corrected README uninstall wording for reference files.
No production/test change. No second Luna pass (one bounded pass per increment).
Coordinator also added a default --no-guidance regression after full suite:
remote-init.test.ts40pass0fail280assertions. Test-only lint closure passed Biome.
