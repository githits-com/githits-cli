# GitHits Init Guided MCP Setup

## Purpose

`githits init` configures MCP and, by default, the supporting GitHits Agent
Skills for the agents selected by the user. This document records the shipped
selection model, skill placement, migration behavior, and human-readable
output contract.

## Setup and selection

Interactive setup and staged `--install-agents` setup use the same per-agent
status model. A selected agent can need MCP setup, guidance repair, or both;
an already-configured but unselected agent is reporting-only and is never
retargeted. Guidance-only and stale-skill cleanup selections do not mutate MCP
configuration or authenticate. An empty selection prints `Nothing selected, no
changes made` and returns before review, authentication, or writes.

The first prompt offers:

1. Remote MCP + skill (simplest, recommended), preselected.
2. Local CLI + skills (supports experimental features): local where supported,
   remote otherwise. Experimental tools remain opt-in on local integrations.
3. Plain MCP (local-first, no guidance).
4. CLI skills only.
5. Exit.

`--remote` and `--local` are mutually exclusive profile selectors and bypass
that profile prompt. `--remote --no-guidance` configures hosted MCP without
writing guidance. An interactive profile choice requests migration. Fresh
no-selector staged/`--yes` setup remains local-first; reruns preserve a valid
canonical local or hosted transport. Preserve mode does not infer installation
history. Cursor has the same hosted config in both profiles, so no-selector
setup retains its existing four-skill policy; explicit remote requests the
MCP-only subset. There is no fallback to another transport after a failure.

A project guidance consent decline recomputes selected actions and exits before
writes when only guidance repair remains. Staged `installableIds` remains
MCP-only; `actionableIds` adds guidance repair. The top-level `setupProfile` is
`remote`, `local`, or `preserve`; per-agent `setupProfile` and `transport` report
the resolved policy/connection. Follow-up commands retain the exact explicit
selector, scope, IDs, `--no-guidance`, and JSON mode.

Claude Desktop always reports `manual_action_required` and the exact directory
page https://claude.ai/directory/githits. The user chooses Connect/Install and
signs in in Claude, then verifies tools in a new conversation. Init never
activates the connector, opens its browser flow, writes Desktop MCP/skills, or
claims it is connected. `manualActionIds` and per-entry `manualAction` describe
this separately from automatic installation. Desktop-only setup returns without
write confirmation or CLI auth; mixed setup keeps manual outcomes outside the
automatic success/failure counts. Unselected Desktop receives no handoff.
Legacy Desktop local bytes are retained and reported when detected; explicit
uninstall can remove that local config. Connector disconnection belongs to
Claude. Desktop remains unsupported at project scope.

## MCP transport and authentication

Host definitions own native config formats, verified locations/scopes, effective
transport, guidance profile, and remote auth instructions. Init resolves these
before scanning and retains them through checks, writes, verification, and
reporting. Setup reuses the existing command/config-file/composite executors.
Config-file checks and native command file probes share one pure classifier;
malformed/unreadable and disabled entries block setup before MCP mutation.
Canonical remote matching preserves host-owned extras, including Q serialized
defaults and Cline settings, while rejecting conflicting local commands/URLs.

Hosted MCP uses https://mcp.githits.com and host-owned OAuth. Entirely hosted
setup and guidance-only repairs do not construct CLI login dependencies. Local
CLI auth only applies to selected local integrations. Configuration success is
not an authenticated tool-discovery result; remote next steps also appear on
configured/guidance-only paths. Cursor retains its MCP-panel Authenticate action,
`cursor-agent mcp login GitHits`, and copyable tool-discovery commands. Other
hosts receive their own auth action and new-session discovery instructions.
Staged Cursor-only auth keeps `managed_by_cursor`; other hosted-only setup uses
`managed_by_host`, with additive per-host `remoteAuth` instructions for mixed runs.

Claude Code and Gemini retain legacy plugin/extension cleanup before native
HTTP or stdio add. Gemini file checks accept both current `{type:"http",url}`
and legacy `httpUrl` user HTTP representations independently of connection
health. User file probes honor `GEMINI_CLI_HOME` as the base containing
`.gemini/settings.json`, matching Gemini native add; project settings remain
relative to the project. Q remote writes the existing `~/.aws/amazonq/mcp.json` map; local add
uses `--force` for explicit replacement and uninstall uses `--name githits`.
Codex remote user/project setup edits native TOML directly: `codex mcp add
--url` starts browser OAuth and would block unattended setup. Login remains the
separate `codex mcp login githits` step. User checks/writes honor `CODEX_HOME`
(default `~/.codex`); relative overrides are resolved before isolated probes.
Local Codex accepts enabled custom/pinned stdio commands and detects the CLI
with bounded PATH/version probes.

The shared TOML editor patches only GitHits entries, including case variants
and descendant tables. It preserves unrelated source, comments, formatting,
BOM and line endings for user and project setup/removal. The existing parser
validates the result against intended settings before atomic write. There is
no whole-file rewrite fallback and no destructive TOML rewrite warning.

Pi keeps its adapter installation and user `lifecycle: eager` / `directTools:
true`; project `.mcp.json` uses the shared native shape. Claude Code and Pi read
the same project GitHits entry; review/detection disclose that changing it
affects both hosts. Other scopes and unrelated server entries are preserved.

## Native remote configuration

Init uses the existing scope/path/server-key/name in each agent definition, replacing
only the selected GitHits entry with its native remote configuration. `URL`
below means the canonical `https://mcp.githits.com`.

| Agent | Remote entry or native user command |
| --- | --- |
| Claude Code | User: `claude mcp add --transport http --scope user githits URL`, retaining existing migration cleanup; project: `{type:"http",url:URL}` |
| Cursor | Existing `{url:URL}` |
| Windsurf | `{serverUrl:URL}` at the existing Windsurf path; no successor product detection/path migration |
| VS Code / Copilot | `{type:"http",url:URL}` |
| Cline | `{type:"streamableHttp",url:URL}` at the existing user path |
| Codex CLI | User/project TOML: `url = "URL"`; user path honors `CODEX_HOME` |
| Pi | Retain existing adapter composite; user: `{url:URL,lifecycle:"eager",directTools:true}`; shared project `.mcp.json`: `{type:"http",url:URL}` |
| Gemini CLI | User: `gemini mcp add --transport http --scope user githits URL`, retaining cleanup and honoring `GEMINI_CLI_HOME` for the settings base; accept native `{type:"http",url:URL}` and legacy `{httpUrl:URL}`; project writes `{httpUrl:URL}` |
| Google Antigravity | `{serverUrl:URL}` |
| OpenCode and Kilo Code CLI | `{type:"remote",url:URL,enabled:true}` |
| Hermes Agent | YAML entry `url: URL`, `auth: oauth`; user scope only |
| Zed and Junie | `{url:URL}` |
| Qwen Code | `{httpUrl:URL}` |
| Kiro | `{url:URL}` |
| Factory Droid | `{type:"http",url:URL}` |
| Amazon Q CLI | User JSON `~/.aws/amazonq/mcp.json`, `mcpServers.githits = {type:"http",url:URL}`; native uninstall is `q mcp remove --name githits` |
| Claude Desktop | Directory handoff only; retain legacy local setup descriptor solely for uninstall |

Verified host contracts (2026-10-20):

- Cline `ca7402c5`, `apps/vscode/src/services/mcp/schemas.ts:87-164`
  explicitly accepts the existing flat format as well as nested transport.
  Explicit `streamableHttp` is required; URL-only defaults to SSE. Keep the flat
  supported format rather than migrating the host's whole config.
- Current public [OpenCode MCP documentation](https://opencode.ai/docs/mcp-servers/)
  uses the existing direct `mcp.<name>` map with remote type, URL, and enabled
  state. Another source directory has a newer nesting shape; do not mistake
  that unrelated/unreleased surface for a requirement to migrate existing setup.
  Installed OpenCode 1.18.30 exposes native `mcp add --url`; Codex 0.163.0 also
  exposes `mcp add --url` (help/version probes only, no user config read).
- Codex `e18a20d6`, `codex-rs/cli/src/mcp_cmd.rs:453-490` writes the
  entry and immediately awaits browser OAuth from `mcp add --url`. Local
  Codex 0.163.0 help has no no-login switch. Remote user setup therefore uses
  the existing TOML executor at `CODEX_HOME/config.toml`, or
  `~/.codex/config.toml` when the environment value is absent/empty; project
  setup keeps `.codex/config.toml`. Preserve sibling settings and preserve surrounding comments/formatting through the shared TOML editor
  described above. Do not run native remote add or manufacture
  a bearer-token variable to suppress OAuth. Report `codex mcp login githits`
  separately. `codex-rs/utils/home-dir/src/lib.rs:13-60` confirms the override
  and default; resolve relative overrides against the working directory, as
  native filesystem paths do. Existing setup creates the config directory if
  needed; no independent Codex-home validator/framework is needed. Keep local
  stdio add and native uninstall unchanged. Regression cases cover default,
  nonempty/empty override, existing siblings, exact remote match, disabled
  state, and no native add or login call during hosted configuration.
- Kilo `5cc65d12`, `packages/sdk/js/src/v2/gen/types.gen.ts:2481` and
  `packages/kilo-docs/pages/automate/mcp/using-in-kilo-code.md` confirm its CLI
  direct map and remote entry. Do not use editor-extension formats.
- Pi adapter `1c7a84d4`, `docs/configuration.md` confirms Pi-owned `mcp.json`
  and shared `.mcp.json`; `docs/auth.md` confirms URL-only OAuth discovery.
  No explicit auth property is required in the shared Claude/Pi project entry.
- Amazon Q `15cc8f3c`, `crates/chat-cli/src/util/paths.rs:59-61` confirms
  `.aws/amazonq/mcp.json`. Its add command requires a local executable, so remote
  setup writes that existing global map instead; `mcp remove` handles the same
  map (`crates/chat-cli/src/cli/mcp.rs:256-260`); its RemoveArgs requires
  `--name githits` (`:211-214`), correcting the existing positional invocation. This is the same legacy global
  source existing local init already uses, not a new caller constraint.
- Gemini `76e4d7c0`, `packages/cli/src/commands/mcp/add.ts:17-153`
  confirms native add only writes configuration and returns, without starting
  OAuth. Current native HTTP output is `{type:"http",url:URL}` whereas legacy
  `httpUrl` remains supported. The user remote file check accepts either native
  HTTP representation at the canonical URL, rejecting SSE, conflicting values,
  malformed or disabled entries; project writes its existing `httpUrl` shape.
  Both supported representations have regression coverage for native add idempotency. User probes follow the native `GEMINI_CLI_HOME` settings base; project paths stay project-relative.
- Official Junie docs confirm URL entries and the existing scope paths.
  Official Droid docs confirm HTTP config and OAuth. Existing Windsurf scope
  stays explicit; the redirected successor docs' path is not adopted.

Remote sign-in instructions belong to each definition: Claude Code `/mcp`,
Cursor existing panel/login commands, Codex `codex mcp login githits`, Gemini
`/mcp auth githits`, Pi `/mcp-auth GitHits`, OpenCode/Kilo native MCP auth,
and the other hosts' documented MCP Authenticate/Authorize action. Every remote
instruction ends with a new-session/tool-discovery check; none claims CLI auth
proves remote readiness. Preserve exact host/server-name spelling.

The native settings-home override does not establish exclusive guidance
discovery. Before changing guidance locations for a custom Gemini home, verify
whether the native host also reads the standard location; the investigation
criteria are recorded in [the backlog](../plans/open-backlog.md#verify-gemini-custom-home-guidance-discovery).

## Supporting MCP guidance

Guided setup writes a managed GitHits block into each selected agent's
instruction file. `GITHITS_GUIDANCE_BLOCK` in
`src/commands/init/guidance-assets.ts` owns this text. It directs agents to use
GitHits first when looking up OSS code, docs, examples, packages, or dependencies,
and to read `githits-mcp` before external lookups. When that skill is
absent, agents call GitHits `quick_start` once per session before other GitHits
tools. Other sources remain available when GitHits is unavailable or its
evidence is insufficient. The skill owns the rule to skip `quick_start` when
loaded; the instruction block does not duplicate it.

Rerun guided `githits init` with the intended agents selected to replace an
older managed block. Local MCP startup refreshes eligible installed skill
content, but does not update agent instruction files.

Remote MCP docs and setup help recommend the `githits-mcp` skill. The skill
carries the stable quick-start guide, so a skill-loaded agent skips the
`quick_start` call. Plain MCP clients use `quick_start` as the fallback
for shared routing, scope, output, and safety guidance because clients expose
server-level MCP instructions inconsistently. Every evidence descriptor repeats
that same session prerequisite, with no tool-specific exceptions. The stable
skill copy is kept byte-for-byte aligned with `buildMcpQuickStart()` in
`packages/mcp/src/mcp/instructions.ts`; runtime-only local appendices are
excluded and do not change when `quick_start` is called.

### Selection wording validation (2026-10-02)

The selection directive addresses a user-reported `gpt-6.1-sol` session that
skipped GitHits for public documentation. The user reported that expanded
GitHits-first wording caused the retest to load the skill and call GitHits.
The initial compact wording was then checked with existing full-guidance,
neutral-intent workloads; the workloads did not explicitly request GitHits.
After replacing "public OSS" and "evidence" with the approved "when looking up
OSS code, docs, examples, packages, or dependencies" sentence, the same three
candidate canaries were rerun with that final wording.
The baseline was a `git archive` of `564e6b6`, with the same measurement harness
and canonical MCP skill as the candidate.

| Agent/workload | Old nudge | Initial compact nudge | Final nudge |
|---|---|---|---|
| `gpt-6.1-sol`, high reasoning, `express-router.md` | Success; 8 logical MCP calls | Success; 7 logical MCP calls | Success; 10 logical MCP calls |
| `gpt-6.1-sol`, high reasoning, `package-overview-vulnerabilities.md` | Success; 2 logical MCP calls | Success; 2 logical MCP calls | Success; 2 logical MCP calls |
| Claude Opus 5.5, `express-router.md` | Not run | Success; 2 observed `grep` requests | Success; 2 observed `grep` requests |

All eight runs loaded `githits-mcp` before their first external lookup, used
GitHits without `quick_start` or web lookup calls, and had no reported isolation
violations. Final reports stated success with high confidence; these are agent
self-reports, not graded usefulness. The Codex traces and normalized metrics
agree on completed calls; Claude's logical-call count and usage were unknown in
the metrics adapter, so its two requests were checked directly in the trace.

These canaries show no observed selection regression. The old nudge also worked
in both Codex cases, so they do not demonstrate an improvement or reproduce the
user's ordinary-session failure. The harness deliberately isolates guidance
and registers GitHits; that environment differs from a normal workspace.

## Skill catalog and active roots

The local-first profile and plugin packages use these four canonical skills:

- `githits-code`
- `githits-mcp`
- `githits-onboarding`
- `githits-package`

The remote profile requests only `githits-mcp` plus existing managed instruction
blocks at verified targets, preserving pre-existing extra/CLI skill files.
Some hosts support skills without an instruction block; Amazon Q has neither
target and reports `guidanceStatus: "not_supported"` while MCP remains installable.
Mixed preserve-mode profiles sharing a skill root take the union by target
file path, independently of selection order.

The runtime catalog is defined in `src/commands/init/guidance-assets.ts` and
is checked for parity with plugin packaging. Missing files are repaired;
only installed `githits-mcp` receives local metadata outside its canonical
payload. The other skill files use the existing unmarked installer path. Shared
roots are deduplicated when multiple selected agents use the same directory.

| Agent group | User scope | Project scope |
|---|---|---|
| Cursor, Windsurf, VS Code/Copilot, Codex CLI, Pi, Gemini CLI, OpenCode, Zed, Junie, Qwen Code, Kilo Code, Cline | `~/.agents/skills/` | `.agents/skills/` |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Kiro | `~/.kiro/skills/` | `.kiro/skills/` |
| Factory Droid | `~/.factory/skills/` | `.factory/skills/` |
| Google Antigravity | `~/.gemini/config/skills/` | `.agents/skills/` |
| Hermes Agent | `~/.hermes/skills/` | not supported |

## Installed MCP Skill Lifecycle

The root `skills/githits-mcp/SKILL.md` and packaged plugin copies remain
canonical and unmarked. Direct `githits init` adds one
`githits-managed-skill` comment immediately after the YAML frontmatter closing
delimiter in the installed `githits-mcp/SKILL.md` only. The comment records the
writing CLI version and a SHA-256 checksum. Its format is:

```text
<!-- githits-managed-skill v1 version=0.26.0 sha256=<64 lowercase hex characters> -->
```

The version is illustrative, not a proposed release version. The checksum
covers the exact canonical UTF-8 file, including frontmatter, whitespace, and
its final newline, excluding only the inserted marker line and its newline.
Removing one valid marker recovers the original bytes; the other three skill
files are not marked. The checksum detects edits, not authenticity: it is not a
signature or authorization boundary.

Init's configured check and setup early return accept a single correctly placed
marker when its checksum verifies and the stripped payload matches the bundled
skill. Equality ignores the marker's writing version, so identical managed
content remains configured across CLI upgrades without a marker-only rewrite.
Explicit init enrolls an unchanged unmarked installation and keeps its existing
overwrite policy for differing content.

The root CLI's local MCP startup updater inspects only existing
`githits-mcp/SKILL.md` targets beneath existing active user roots and project
roots derived from the startup working directory (`cwd`) in the shared init
map. It does not walk parent directories or discover Git roots, create roots,
parent directories, or missing files; inspect historical Cline/Junie migration
paths or plugin caches; or update other skills.
Symlinked homes and active roots are allowed, including intentionally owned
dotfiles roots. A directory or file alias is accepted only when its resolved
skill file equals an expected destination under an active root. Resolved
destinations are deduplicated and updates target the resolved file, preserving
the alias links. Escaping aliases and non-regular files are skipped. Hosted or
plugin-only MCP launches do not invoke the local updater.

An unmarked exact current payload is left byte-identical. A fixed set of 25
verified pre-feature SHA-256 hashes bridges known older unmarked installs;
unknown unmarked content is preserved. The hashes and fixture payloads were
verified on 2026-10-01 against all 44 published npm releases from 0.6.0 through
0.25.1 and the available release tags; [npm registry provenance](https://registry.npmjs.org/githits)
is retained here. The fixture keeps per-version payload bytes and hashes. A
marked payload identical to the bundled skill is silent regardless of writing
version. A different payload is refreshed only when its writing CLI version is
older than the running CLI. A different same-version payload is preserved
silently; a different newer-version payload is preserved with a short warning.
Malformed, duplicate, misplaced, unsupported, or checksum-mismatched markers
are preserved.

Maintenance runs after ordinary startup dependency validation and before the
local MCP server connects. Failure to discover a user or project base emits a
sanitized warning while discovery of the other scope continues; a deleted cwd
can skip project-root maintenance without blocking user-root maintenance or
startup. Other policy and IO failures also produce sanitized stderr warnings
and do not block startup; stdout remains reserved for MCP protocol output.
The startup factory also catches unexpected maintenance failures; even a
maintenance warning failure cannot prevent the server from connecting.
Before replacement, the updater rereads the file and requires it to match the
inspected bytes, then uses the existing atomic replacement helper.
That final check narrows but cannot eliminate a manual-edit or competing-launch
race before rename; the lifecycle makes no stronger concurrency guarantee.
Startup changes the file on disk only: agents that loaded it earlier in the
session do not hot-reload and need a new session to see refreshed content.

See [configuration](config.md#local-mcp-skill-update-policy) for the opt-out
and persistent `skills.auto_update` setting.

Implementation references:

- `src/commands/init/guidance-assets.ts` owns the canonical skill and active-root map.
- `src/services/mcp-skill-content.ts` owns marker parsing, checksums, and version decisions.
- `src/services/mcp-skill-update.ts` owns startup scope, alias checks, reread, and replacement.
- `src/services/mcp-skill-history.ts` and
  `src/services/fixtures/mcp-skill-history.json` hold the fixed hashes and
  verified payloads.
- `src/services/mcp-skill-content.test.ts` checks that the 25 fixture hashes
  match the unique legacy array.
- `src/services/skill-config.ts` owns the local update policy reader.

The shared root is intentionally visible to every compatible agent that reads
it. The Ready/Next Steps output says this explicitly for successful or already
configured shared-root guidance. Agent-specific managed instruction blocks
remain separate targets and are written only for selected agents.

## Cline and Junie migration

Cline and Junie now use the shared `.agents/skills` root. Historical cleanup
targets are only the exact CLI-owned files
`<scope>/.cline/skills/githits-mcp/SKILL.md` and
`<scope>/.junie/skills/githits-mcp/SKILL.md`; unrelated skills, directories,
plugin payloads, and managed instruction blocks are preserved.

Guided setup writes and verifies its requested skill subset before removing a
historical file. If active installation or verification fails, the historical
file remains. If cleanup fails, the active set remains usable and the exact
failed historical path is reported with a generic reason. Missing historical
files are successful no-ops. `--no-guidance` leaves historical files untouched.
After successful cleanup, another guided run is a no-op for that migration.

## Uninstall and reporting

The canonical command is `githits uninstall`; `githits init uninstall` remains
a compatibility alias with identical `--yes`, `--project`, and
`--keep-guidance` behavior. Without `--keep-guidance`, interactive user
uninstall best-effort removes active and historical guidance only for selected
tools. It retains a shared skill or managed-block target when any unselected
detected tool could use it, and retains a selected tool's guidance when its MCP
removal fails. Non-interactive `--yes`, project uninstall, and user uninstall
with no configured MCP targets clean every verified guidance target in the
chosen scope. Cleanup removes all four active skill files and the exact
historical Cline/Junie files while preserving unrelated files and directories.
The `--keep-guidance` option preserves active and historical guidance.
When cleanup removes a shared root, the result warns that every compatible
agent reading that root is affected.

Human output lists created, updated, unchanged, removed, and failed skill files
accurately. Uninstall failure reasons are sanitized while failed target paths
remain visible; an all-absent guidance cleanup collapses to one unchanged row.
Configured, already-configured, and failed counts appear in Install and verify
before Ready/Next Steps. Natural-language init/uninstall prose wraps at the
terminal width (80-column fallback, 40-column minimum); JSON, standalone
copyable command lines, paths, and change rows remain byte-stable and
unwrapped, while inline commands in prose may wrap.

## Public skill and release boundary

The public `skills/githits-onboarding/SKILL.md` was reviewed in this feature
branch: it contains no `init uninstall` reference and its existing description
is host-neutral. It is intentionally not edited here. Behavior-dependent
changes to the published onboarding skill are made on the release branch only
after the corresponding CLI behavior is included, so `skills.sh` does not
advertise unreleased behavior.

## Key references

- `src/commands/init/init.ts` — selection, transport, authentication, output,
  migration, and uninstall orchestration.
- `src/commands/init/guidance-assets.ts` — four-skill runtime catalog.
- `src/commands/init/agent-definitions.ts` — Pi and Codex host behavior.
- `src/commands/init/setup-format.ts` — human prose wrapping and change rows.
