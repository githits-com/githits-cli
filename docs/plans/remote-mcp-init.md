# Plan: Hosted MCP installation through init

## Status and outcome

Status: IN PROGRESS. The user invoked `$orchestrate` after settling the menu,
remote interactive default, guidance sets, and Desktop directory handoff.
Implementation is authorized; three required external plan rounds completed.
Final low findings are adjudicated below, with no fourth round.
Baseline refreshed to `94f3952` (`origin/main`, GitHits 0.34.0) on 2026-10-20;
its 12 new commits did not change init. The user approved preserving an existing
valid transport on no-selector unattended reruns; explicit profiles migrate.
Plan round 2 confirmed the previous closures. After clarification, the user
objected to dropping config comments. Adopt targeted TOML edits preserving the
surrounding file, including existing project setup; no open product decision.

Expected outcome: a user can configure GitHits through `https://mcp.githits.com`
and install the MCP skill and managed instruction block at verified host
targets, without running a local
GitHits MCP process or authenticating the GitHits CLI. The existing setup route
remains available. The completed design covers the existing host catalog rather
than arbitrarily exposing remote setup to only five agents.

## Confirmed decisions and rejected proposal

- User confirmed on 2026-10-20: install only `githits-mcp` and the existing
  GitHits-first managed instruction block for remote setup. Preserve existing
  unrelated and CLI-oriented skill files.
- User revised the earlier default decision: put remote first in the menu and
  make it the preselected interactive default. The local-first profile remains
  an explicit choice. Fresh no-selector staged/`--yes` installs stay local-first.
  User subsequently confirmed that no-selector unattended reruns preserve an
  existing valid canonical transport; only an interactive profile choice or
  explicit `--remote`/`--local` requests migration. The Desktop directory
  handoff below is independent of that transport policy.
- User refined the local option's framing: local CLI where supported, remote
  otherwise, with support for experimental features. Call this the local-first
  profile. Experimental features are opt-in and apply only to its local
  integrations; remote-only targets do not gain them by selecting this profile.
- User identified the existing GitHits Claude directory connector and proposed
  replacing Desktop MCP installation with its directory link. Adopt that simpler
  end state in both MCP setup profiles: show
  `https://claude.ai/directory/githits` for the user to connect in Claude. This is
  an intentional exception to preserving Desktop's current local setup behavior;
  Claude Code retains its separate automatic MCP setup. No-selector unattended
  reruns preserve existing valid transports as confirmed above.
- The five-host launch proposal was not accepted. The user identified uneven UX
  and the fact that the existing first option already uses hosted MCP on some
  platforms. Do not reintroduce that arbitrary cutoff.
- Subsequent user refinements retain profiles in the first menu, with broad
  coverage and remote as the default. Agents-first connection selection below
  remains a considered alternative, not a blocking product decision.

## Verified baseline

Repository evidence initially at `2196667`, rechecked unchanged for init at
`94f3952`, branch `jlitola/feat-remote-mcp-init`:

- `src/commands/init/init.ts` offers guided MCP, plain MCP, standalone skills,
  and exit. Guided MCP is the default. Scope selection and agent detection follow
  intent selection. Staged detection/install and non-interactive help have their
  own paths through the same command.
- `src/commands/init/agent-definitions.ts` defines 19 agents. Direct init uses
  local `npx -y githits@latest mcp start` except Cursor, which already uses the
  hosted endpoint at both user and project scope.
- Generated plugin/extension installs already use hosted MCP. Their separate
  packaging route is not a reason to install a plugin from direct init.
- Host callbacks own setup config and commands. `scanAgents()` resolves and
  retains the setup configuration/context, but post-install verification scans
  again. A route must survive both scans.
- Claude checks `.claude.json` for an exact local invocation. Codex currently
  accepts any enabled, structurally valid named entry without checking its
  transport. Gemini's check matches the local command in `mcp list` output.
  These checks cannot be reused unchanged for remote migration.
- Config-file installation replaces the GitHits entry while preserving sibling
  servers. Checks compare the expected entry. Uninstall generally checks
  presence, but Gemini's CLI-only local-command check needs particular attention
  so a hosted entry is not misclassified as absent.
- `guidance-assets.ts` owns the four-skill catalog and verified active roots;
  `init.ts` owns setup/check/repair/migration orchestration. Those paths currently
  expect all four skills. CLI code/package skills explicitly route to shell
  commands. Remote installation needs a catalog subset, not new authored copies.
- The installed MCP skill already contains the stable guide. Remote startup
  cannot run the local MCP skill updater; an explicit init rerun can refresh it.
- `LOCAL_EXPERIMENTAL_TOOL_DEFINITIONS` is currently empty. Experimental tools
  are opt-in locally. `research` is stable. Describe remote as excluding *local
  experimental tools*, not as missing today's research capability or implying
  the default local route enables experiments.
- Baseline validation: `bun test src/commands/init/agent-definitions.test.ts
  src/commands/init/claude-user-config.test.ts
  src/commands/init/setup-handlers.test.ts src/commands/init/init.test.ts` passed:
  537 tests, 0 failures, 1,923 assertions (2026-10-20).

## Host capability survey

This is documentation/source evidence, not proof of an authenticated GitHits
connection in every installed agent version. All 19 current entries are accounted
for below. Existing project-scope limitations still apply.

| Existing agent | Remote evidence | Planning consequence |
| --- | --- | --- |
| Claude Code | Native HTTP and OAuth; user/project configuration | Use native HTTP setup and route-aware checks |
| Cursor | Already hosted in this repository | Preserve URL format and separate Cursor OAuth |
| Windsurf | Current official URL redirects to Devin Cascade docs, documenting HTTP/OAuth and different config paths | Keep the existing Windsurf target and native serverUrl shape; do not migrate successor paths (detailed resolution below) |
| VS Code / Copilot | HTTP config and interactive authentication documented | Use the supported VS Code config destination; do not migrate harness configuration as incidental work |
| Cline | Source implements Streamable HTTP with OAuth | Use the verified backwards-compatible flat streamableHttp shape (detailed resolution below) |
| Claude Desktop | User confirms GitHits already has a directory connector; official Claude docs describe user-controlled directory connection; no verified local skill/instruction target | Link to the GitHits directory page in both MCP profiles; perform no local MCP or skill installation |
| Codex CLI | Streamable HTTP, OAuth, and user/project TOML documented | Write user/project TOML without starting OAuth; inspect transport/URL as well as enabled state |
| Pi | Existing pi-mcp-adapter supports URL and OAuth | Preserve the current adapter integration; verify version/config compatibility rather than replacing it with a different Pi integration |
| Gemini CLI | `httpUrl`, native HTTP add command, `/mcp auth` | Remote-aware config check independent of completed authentication |
| Google Antigravity | Native `serverUrl` and OAuth documented; generated package already remote | Use native serverUrl at the existing supported user/project locations |
| OpenCode | Native remote type and OAuth documented | Use the direct mcp map confirmed by public host documentation; do not adopt another source surface's nesting (detailed resolution below) |
| Hermes Agent | URL entries and `auth: oauth` documented | Preserve YAML and user-only scope; use host-owned authentication |
| Zed | URL entries with automatic MCP OAuth documented | Replace local entry with native remote entry; preserve settings siblings |
| Junie | Native remote connection and Authorize action documented | Preserve existing user/project locations; report manual authorization |
| Qwen Code | HTTP MCP and OAuth documented | Use native httpUrl at the existing user/project settings locations |
| Kiro | URL-based remote MCP with automatic OAuth documented | Preserve verified scope, use native remote config |
| Kilo Code | CLI's remote type/OAuth documented | Follow Kilo CLI config, not its separate editor extension |
| Factory Droid | Native HTTP and `/mcp` OAuth documented | Preserve user/project config and report host sign-in |
| Amazon Q CLI | Native HTTP/OAuth in agent configuration documented | Verify the installation/removal path; do not assume existing `--command` setup can accept a URL |

Primary sources checked on 2026-10-20:

- [Claude Code MCP](https://code.claude.com/docs/en/mcp),
  [Claude directory connector setup](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities),
  [GitHits directory page supplied by the user](https://claude.ai/directory/githits).
  The browser tool could not retrieve the GitHits listing; its existence is
  user-confirmed. Official documentation establishes that users choose Connect
  or Install and complete authentication. No supported programmatic activation
  path has been established; do not present that as proof none can exist.
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
  [Gemini MCP](https://geminicli.com/docs/tools/mcp-server/),
  [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
- [Windsurf/Cascade official documentation redirect](https://docs.windsurf.com/windsurf/cascade/mcp),
  [Kiro configuration](https://kiro.dev/docs/mcp/configuration/),
  [Droid MCP](https://docs.factory.com/harness/mcp),
  [Antigravity MCP](https://antigravity.google/docs/mcp),
  [Junie MCP](https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html),
  [Amazon Q CLI MCP](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-mcp-config-CLI.html)
- GitHits source/docs lookup: `github:cline/cline`,
  `github:anomalyco/opencode`, `github:zed-industries/zed`,
  `github:nicobailon/pi-mcp-adapter`, `github:NousResearch/hermes-agent`,
  `github:QwenLM/qwen-code`, and `github:Kilo-Org/kilocode`.
  Several searches explicitly returned older snapshots; exact supported-version
  adapter questions from that survey are resolved in the detailed contracts
  below; this survey alone is not live interoperability proof.

## UX alternatives and recommendation

Ownership: each agent definition naturally owns its supported connection shape,
configuration location, and authentication instructions. Init owns the user's
setup intent and review. A global "everything except Cursor is local" rule is
the wrong boundary once multiple hosts can use either connection.

### A. Profiles first, broad host coverage — selected

First menu:

1. `Remote MCP + skill (simplest, recommended)` — preselected interactive
   default. Hosted GitHits; authenticate in each agent; no local GitHits MCP
   process or local experimental tools.
2. `Local CLI + skills (supports experimental features)` — use the local CLI
   where supported and remote MCP otherwise. Local integrations support opt-in
   experimental features. Cursor uses hosted MCP; Claude Desktop points to the
   directory instead of installing a local
   server. The option describes the supported local runtime, not a new global
   CLI installation: existing integrations launch it through `npx` on demand.
3. `Plain MCP (local-first, no guidance)` — preserve the existing unguided route.
4. `CLI skills only` — preserve the existing standalone-skills route.
5. `Exit`.

Then select scope and agents as today. Agent rows and the review show the actual
connection, whether it is already configured or will be replaced, and whether
the remaining work is automatic configuration or connecting through the Claude
directory. Never
silently use stdio after the user selected remote.

The local-first profile chooses its connection from each host's verified
capabilities before installation. It does not attempt a local install and then
switch to hosted MCP on failure. For targets using remote MCP, the review makes
that connection and the absence of local experimental features explicit.
Selecting this profile does not enable experiments or write experimental
settings. Its current four-skill guidance set stays unchanged, including on
Cursor; the explicit remote profile installs only the MCP skill.

Desktop's next step is concise and copyable:

```text
Claude Desktop — connect through the Claude directory
https://claude.ai/directory/githits
Open this page, choose Connect, and complete sign-in in Claude.
```

Do not send users through custom-connector creation when the directory listing
already provides the GitHits connector. Exact button wording may vary between
Connect and Install; follow the directory UI. If an organization restricts access,
Claude handles that restriction; init does not attempt to grant access.

This preserves the user's confirmed menu/default choices and adds no connection
prompt. It requires complete host capability descriptions; a setup profile is
not a promise that all hosts use an identical config format or login UI.

### B. Agents first, connection choice afterward — considered, not selected

Keep the initial intent transport-neutral, detect/select agents, then present
hosted versus current setup with actual compatibility shown. Remote and local
choices appear only when meaningful for those selected hosts.

This explains compatibility earlier and avoids an abstract transport choice
before users know their targets. It changes the existing flow more broadly,
adds a prompt for mixed capabilities, and revises the user's earlier request to
place remote in the first menu. Estimated implementation cost is higher than A;
no measured timing or code-size estimate is claimed.

### C. Keep the existing behavior

Lowest change cost; hosted installation remains available through plugins and
Cursor. Does not satisfy the requested remote option for other direct-init
targets. Suitable only if the user chooses further design exploration.

Automatic remote-to-local fallback is not recommended: it would make the
explicit remote choice misleading and reintroduce local authentication/runtime
requirements without clear consent.

## Proposed architecture and contracts

Under the selected profiles-first UX:

- Resolve the setup profile once. Use existing agent definitions, scan context,
  setup executors, and guidance placement. Do not create a parallel remote
  installer or a provider/plugin framework. The local-first profile chooses
  local CLI where supported, hosted MCP otherwise, with the Desktop directory
  handoff as documented. Resolve this from verified host capabilities rather
  than treating install/probe errors as a reason to change connections.
- Add mutually exclusive `--remote` and `--local` profile selectors.
  `--remote --no-guidance` requests hosted configuration without guidance writes;
  `--local` requests the local-first profile, including Cursor's hosted route.
  No-selector staged/`--yes` runs preserve an existing canonical connection and
  use local-first only for fresh/unconfigured targets. Reject both selectors
  together before detection, auth, or writes. Preserve the exact selector in
  emitted follow-up commands; do not add one to a preserve-mode command.
- Carry the selected profile into detection, installation, verification, human
  review, JSON, and emitted detect/retry/install commands. Derive effective
  transport and authentication instructions from the host definition, not ID
  checks scattered through init. Keep existing `installableIds` semantics and
  add explicit manual-action information instead of counting a UI handoff as
  installed. Additive fields are specified in the detailed contracts below;
  do not change existing fields' meaning.
- Use only the canonical hosted endpoint, following existing endpoint ownership.
  Do not add custom endpoint flags, token copying, an auth proxy, `mcp-remote`,
  new persistent settings, background processes, or fallback transports.
- Remote authentication belongs to the host. Never construct local CLI login
  dependencies for an entirely hosted selection. Configuration success is not
  proof of authenticated tool availability. Report next steps per host, including
  on already-configured and guidance-only paths.
- Route-aware configuration matching distinguishes correct configuration,
  another transport/URL, disabled state, absence, and a failed/malformed probe.
  Explicitly selected supported targets can migrate in either direction;
  unselected hosts and other scopes remain unchanged except when a selected
  target writes a config entry shared by multiple hosts (Claude Code/Pi project
  `.mcp.json`). Review output must disclose that shared-file effect. Preserve existing fail-before-write behavior
  for disabled entries and failed probes. No generic retry/rollback mechanism.
- Remote guidance uses the one-skill subset of the canonical catalog and existing
  managed instruction blocks, only where each target is verified. Some hosts
  support skill files without a managed instruction target. Amazon Q currently
  has neither target: show MCP-only configuration and `guidanceStatus:
  "not_supported"` rather than claiming guidance was installed. Do not invent
  a new guidance root for this increment. All checks, repair, reporting, and historical-file
  migration use that subset consistently. Existing extra skills are preserved.
  The local-first profile still uses four skills. Shared-root deduplication
  takes the union by target skill path: a mixed preserve-mode local/remote
  selection sharing ~/.agents/skills installs the four-skill union regardless
  of agent order. An explicit remote selection still requests only MCP skill.
- Uninstall is based on presence, independent of the chosen install profile,
  and removes either connection through the existing command. Preserve current
  selected-agent/shared-guidance protection and `--keep-guidance` behavior.
  Preservation of pre-existing CLI skills above applies during installation.
  Canonical uninstall retains its existing four-skill cleanup contract, including
  CLI skills present before remote setup; `--keep-guidance` preserves them.
  State this in uninstall help/docs and test remote setup followed by uninstall
  with pre-existing CLI skills. Do not infer file ownership from the configured
  transport or add installation-history metadata.
- Claude Desktop's directory handoff belongs to init's per-host next-step output,
  not the filesystem/command setup executors: it performs no installation.
  In both MCP profiles, show the exact directory link without starting local CLI
  authentication, opening a browser automatically, creating MCP/skill files, or
  claiming connector readiness. A Desktop-only run prints those next steps and
  returns without a write-confirmation prompt. A mixed run keeps Desktop in an
  external-action group outside automatic install/success/failure counts.
  Staged detection exposes the handoff separately from `installableIds`, and an
  explicit Desktop staged request returns that handoff rather than attempting
  the legacy install. It must not prompt an agent to keep retrying installation.
  The connector is account-level; this does not invent project-scope support.
- Preserve any existing Desktop stdio config during init. Mention the existing
  local integration when detected so users understand that it was retained;
  do not automatically remove it or verify the directory connector by inspecting
  that local entry. Keep legacy local-config removal available in the existing
  uninstall flow. Directory disconnection belongs to Claude's connector UI and
  is not something CLI uninstall can claim to have done.

## Scope and constraints

Include direct-init CLI UX, per-host supported native remote setup, migration,
authentication instructions, skills, staged commands/JSON, uninstall parity,
tests, smoke coverage, and durable installation documentation. Keep generated
plugin payloads and their four-skill contract unchanged.

Exclude hosted server implementation/deployment, changing MCP tool inventory,
inventing remote support in another product, managing third-party credentials,
automating browser consent, adding new hosts, and a general host-version
migration framework. If a verified host schema change prevents correct setup,
bring the smallest compatibility correction versus a narrower supported-version
contract to the user; do not silently redesign unrelated host integrations.

Performance: this is setup behavior, not an optimization. Reuse existing bounded
local probes; do not add network health checks as configuration checks. No
benchmark claim is proposed.

## Assumptions, unknowns, and dependencies

Assumptions: hosted endpoint ownership and stable tool inventory remain in
`remote-mcp`; init installs local skill snapshots; remote OAuth needs separate
user interaction per host. These follow repository boundaries and documented
host behavior, not an assertion that live end-to-end interoperability was tested.

Product decisions: none. After clarification of the loss, the user objected to
dropping comments; implement targeted preservation in shared TOML handling. The
user approved no-selector transport preservation after external review round 1. Host compatibility and the completed staged
contracts are specified below. No new version-discovery framework or successor-host migration is needed.
The implementation targets the existing host integrations/locations; it does not
claim support for every unreleased schema on upstream default branches.

Dependencies: no backend feature or new infrastructure identified. Actual hosted
OAuth interoperability remains an integration-validation requirement. If a host
requires incompatible authorization metadata, report the boundary and obtain a
product decision before proposing backend changes.

## Detailed implementation contracts and evidence

### Native remote configuration

Use the existing scope/path/server-key/name in each agent definition, replacing
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
| Gemini CLI | User: `gemini mcp add --transport http --scope user githits URL`, retaining cleanup; accept native `{type:"http",url:URL}` and legacy `{httpUrl:URL}`; project writes `{httpUrl:URL}` |
| Google Antigravity | `{serverUrl:URL}` |
| OpenCode and Kilo Code CLI | `{type:"remote",url:URL,enabled:true}` |
| Hermes Agent | YAML entry `url: URL`, `auth: oauth`; user scope only |
| Zed and Junie | `{url:URL}` |
| Qwen Code | `{httpUrl:URL}` |
| Kiro | `{url:URL}` |
| Factory Droid | `{type:"http",url:URL}` |
| Amazon Q CLI | User JSON `~/.aws/amazonq/mcp.json`, `mcpServers.githits = {type:"http",url:URL}`; native uninstall is `q mcp remove --name githits` |
| Claude Desktop | Directory handoff only; retain legacy local setup descriptor solely for uninstall |

Resolved source questions:

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
  described below. Do not run native remote add or manufacture
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
  Test both supported representations so a native add is idempotent.
- Official Junie docs confirm URL entries and the existing scope paths.
  Official Droid docs confirm HTTP config and OAuth. Existing Windsurf scope
  stays explicit; the redirected successor docs' path is not adopted.

Remote sign-in instructions belong to each definition: Claude Code `/mcp`,
Cursor existing panel/login commands, Codex `codex mcp login githits`, Gemini
`/mcp auth githits`, Pi `/mcp-auth GitHits`, OpenCode/Kilo native MCP auth,
and the other hosts' documented MCP Authenticate/Authorize action. Every remote
instruction ends with a new-session/tool-discovery check; none claims CLI auth
proves remote readiness. Preserve exact host/server-name spelling.

### Minimal ownership and data flow

`agent-definitions.ts` resolves the selected init mode to agent definitions
with effective `mcpTransport` (`stdio` or `http`), setup profile, optional
directory URL, and remote verification instructions. Existing scope factories
and `resolvedSetupConfig` carry this through scans and verification. Base legacy
definitions remain available to uninstall. No module-global mutable mode.

The init mode is `remote`, `local`, or internal `preserve`; preserve is not a
third menu choice or persistent setting. In preserve mode, scan the local-first
configuration first and, only for a non-matching valid entry, check the known
remote variant. If either is canonical, retain that variant's resolved setup,
effective transport, and guidance profile through verification/reporting. Failed
probes, malformed entries, and disabled entries do not trigger an alternate
write. If neither canonical variant exists, keep the local-first setup target.
Cursor's local-first and remote variants have the same native connection, so
no-selector behavior retains its existing local-first guidance policy; an
explicit remote selection uses the one-skill subset. No installation-history
metadata is inferred or stored.

The resolver uses the existing detection/path declarations. Config-file remote
variants reuse their local path/scope setup with a native remote entry; CLI
hosts use their native config-only add commands, except Codex remote and Q
remote, which use their existing native config files. The installer still executes existing
`SetupConfig` variants. Add no separate remote executor.

Guidance selection belongs to the existing guidance builder: derive the catalog
subset from the selected profile on the resolved agent, retaining shared-root
deduplication. Fix any place rebuilding from bare global definitions so it uses
the scanned definition. This keeps one profile value rather than threading a
collection of transport booleans through the installer.

The config-check owner is `setup-handlers.ts`: reuse its format parser and
extend entry equivalence to distinguish malformed/probe failure, absence,
disabled, wrong entry, and matching entry. Remote equivalence matches all
expected fields and transport/URL indicators exactly, tolerates additional
non-transport fields (for example Q serialized defaults or Cline UI settings),
and rejects a non-empty local command or conflicting transport indicators.
Empty serialized local-command/default fields on a remote Q entry do not imply
a local transport. Local matching likewise tolerates empty serialized URL
defaults, but rejects a non-empty remote URL including `httpUrl`. Matching
canonical remote entries must not be rewritten merely to drop host-owned extras. Claude's existing parser accepts an expected
HTTP shape in addition to the local invocation. Codex's local JSON probe checks the actual transport; its remote TOML check
uses the same config-file classifier and exact URL. Preserve existing acceptance
of enabled custom/pinned local stdio invocations rather than canonicalizing
them to `npx@latest` as incidental work. Gemini's probe must classify config
independently of OAuth/connection health and preserve presence for uninstall.
Amazon Q must also use a transport-aware check against its global JSON entry
instead of the existing name-only `/githits/i` list check. Explicit remote-to-local
replacement uses native `q mcp add --force` against that same existing global map.
Include Q's serialized `headers`, `oauthScopes`, empty command/args and URL
defaults, timeout, and disabled fields in local/remote matching regression cases.
Do not print raw probe content or include credentials in failure reasons.

### Interactive and staged behavior

- Bare interactive init preselects remote. Explicit `--remote` or `--local`
  selects that profile without a contradictory intent choice; scope/agent
  selection still occurs. `--no-guidance` alone retains the existing interactive
  plain/local-first route. No-selector `--yes`/staged commands use preserve mode:
  existing canonical transports stay configured; new targets use local-first.
  Explicit selectors, including with `--yes`, request migration.
- Add `ScanResult.manualSetup` for detected user-scope directory handoffs; skip
  the config probe/write for those entries. Project Desktop remains unsupported.
- Add staged `manual_action_required` status, per-entry `manualAction` with URL
  and instructions, and top-level `manualActionIds`. Keep `installableIds`
  MCP-only and `actionableIds` MCP-or-guidance-only. Interactive selection can
  additionally select manual IDs; staged explicit requests accept detected
  manual IDs and return `manual_action_required` outcomes. Suggested install
  commands exclude manual-only IDs; show their direct action instead.
- Add top-level `setupProfile: "remote" | "local" | "preserve"` and per-entry
  `transport: "stdio" | "http"` (omitted for directory handoffs) to staged output
  without changing existing fields' meanings. Follow-up commands retain the
  explicit `--remote` or `--local` selector (neither in preserve mode), scope, and
  `--no-guidance`. Existing Cursor-only auth payload remains compatible; other
  entirely remote selections report host-managed auth, with per-host next steps.
  Mixed local/remote MCP work retains local `auth` and adds remote auth
  information. As before, local auth applicability follows targets needing MCP
  setup, not already-configured targets selected only for guidance repair.
- Install success counts exclude manual handoffs. Desktop-only runs return its
  directory instructions before write review/auth. Mixed runs show directory
  steps separately. Unselected Desktop does not trigger a handoff or mutation.
- Remote canonical/no-change and guidance-repair paths still show host auth and
  discovery steps. They do not instantiate local login dependencies or claim
  “ready” from config presence alone. Local guidance-only repair stays auth-free.

### TOML source preservation

Ownership: the existing config format layer owns changing a server entry while
preserving surrounding text. A pure TOML edit helper under init is appropriate
if needed to avoid growing setup-handlers.ts; agent definitions must not contain
text-editing logic. Do not add a second installer or a runtime dependency.

Use the existing smol-toml parser to validate document semantics and for key
decoding/serialization of replacement values; retain original source outside
the selected GitHits entry. A small source-span scanner identifies statements,
quoted keys, string literals, comments and nested inline tables/arrays. It does
not replace semantic validation. Patches apply to every case-insensitive match for the selected server name
(as existing merge/remove already do), including all descendants; e.g.
`GitHits` and `githits` duplicates collapse to one canonical entry on merge
and all are removed on uninstall. Preserve a leading BOM. Supported syntax:
standard table headers, dotted keys, quoted names and inline-table forms must
all work. Descendant tables/array-of-tables under the selected server (for
example `[mcp_servers.githits.env]`) belong to that server and must be removed
or replaced with it, so stale fields cannot survive migration/removal. Preserve unrelated statements, comments, layout and newline style.
Replacement may reformat GitHits-owned values; preserve surrounding and
standalone comments. There is no destructive reserialization fallback. Verify
the resulting parsed settings equal the intended merged document before write.

Use the same edit primitive for existing TOML project setup/removal and new
user remote setup, so there is no divergent Codex text path. Remove the obsolete
whole-file TOML rewrite warning and update the documented project behavior.
Cases include absent table, existing local/remote entry, siblings, inline
parent/server tables, descendant env tables/array-of-tables with sibling
comments in merge and removal, dotted keys, quoted keys, multiline strings/arrays,
comments containing table-like text, CRLF, idempotency and malformed-file no-write.
Use fake fixtures only. Coordinator owns this judgment-heavy slice; Luna Claude config-parser
slice can run independently once plan review is complete.

Baseline reproduction (2026-10-20): pure mergeServerConfig on a fake annotated
Codex TOML fixture returns added with commentsPreserved=false, modelPreserved=true,
otherServerPreserved=true. No real user configuration was read or written.

### Ordered orchestration slices

One Luna implementor, sequential dispatches; full-access parent means full-access
worker, regardless of role defaults. Every worker brief declares exact owned
files, one concern, one focused proof command, and no permission to expand tests
or infrastructure. Workers return uncommitted deltas; coordinator commits after
inspection and applicable build checks.

1. Luna: extend Claude's pure config parser to recognize an expected HTTP entry;
   own `claude-user-config.ts` and its test. Focused tests prove exact URL/type,
   local-to-remote/remote-to-local mismatch, malformed values, and no secret output.
2. Coordinator: resolve native remote setup descriptors, transport/auth metadata,
   and shared configuration classification; fix shared TOML source preservation
   inline before enabling remote user writes. Luna: add the explicit 18-agent
   remote shape matrix to `agent-definitions.test.ts`; tests check each named
   user/project supported shape and preserve unsupported scopes.
3. Coordinator: route interactive/staged detection, install, verification, auth,
   and guidance through the selected profile. Luna: add one focused remote-skill
   subset test group proving one-skill repair/preservation and no local auth.
4. Coordinator: implement Desktop directory outcomes and legacy-only uninstall.
   Luna: add isolated Desktop-only/staged handoff regression cases, then a
   separate dispatch for mixed-selection reporting/preservation cases.
5. Coordinator: inspect and verify full behavior, adding judgment-heavy migration,
   failed-probe, disabled-entry, and authentication regression cases inline.
6. Luna: update selected durable installation/transport docs to the final contract
   (explicit file list, no public onboarding skill change). Separate dispatch:
   add the release fragment. Separate dispatch: add remote help/flag smoke coverage.
7. Coordinator: run full verification, one fresh Luna conformance preflight,
   internal technical review, then the required fresh external Claude code
   review loop. Apply accepted findings through their file owner; repeat code
   review after code findings. Push and open a labeled draft PR, never merge.

Worker proof commands must use named `bun test` test-name patterns, with exact
per-case output, not aggregate suite counts. No worker edits to plan/review state,
credentials, git history, or files outside its supplied ownership list.

## Phase map

Phase 1 — users can complete or receive accurate native completion steps for
the hosted setup profile across the existing catalog; the local-first option
and no-selector unattended reruns preserve working connections (IN PROGRESS).

One implementation increment is preferred. If verified implementation would
exceed 1.5–2k production-code lines, stop and propose a smaller delivery split
that preserves the overall outcome. Tests/docs are excluded from that threshold.
Do not split merely to postpone compatibility analysis.

### Phase 1 detail horizon

Expected outcome: selected supported targets use the requested native connection
and correct guidance; manual targets are reported honestly; no hosted-only setup
depends on CLI login or a local GitHits MCP runtime.

Assumptions: the confirmed skill/default decisions above remain; existing setup
and presence-check executors can be reused. Known contracts are specified above; product decisions: none. Dependencies:
plan review adjudicated after its three-round limit; implementation review pending.

Likely files: `src/commands/init/{init,agent-definitions,claude-user-config,
guidance-assets,setup-handlers}.ts` and corresponding tests;
`scripts/cli-smoke.ts`; root `README.md`; `docs/implementation/{cli-commands,
init-guidance-and-expanded-agent-support,init-setup-output,plugin-packaging}.md`;
the applicable transport notes in `AGENTS.md` and internal maintenance skill.
Implement the ordered sequence and exact host contracts above. Preserve existing
unsupported-project reasons and host detection. No host-version migration
framework or new runtime infrastructure is authorized.

Required acceptance criteria:

1. Menu/default and selected-host review match the approved UX.
2. All advertised automatic host/scope combinations have exact config/command
   assertions and matching probe tests, with hosted-only login bypass verified.
   Host-normalized Q/Cline fixtures preserve non-transport extras and remain
   idempotent; both explicit Q migration directions are covered.
3. Fresh setup, idempotent rerun, both migration directions, mixed Cursor/current
   setup, unselected agents, other scopes, malformed/disabled/probe-failure cases,
   and partial installation failures behave as specified without hidden fallback.
   Remote install followed by no-selector detect/staged install/`--yes` remains
   remote and requires no local login. Fresh no-selector targets remain local.
   Explicit `--local` and `--remote` migrate in each direction; conflicting
   selectors fail before side effects. A mixed existing-local/existing-remote
   scan reports each actual transport without treating either as repair.
   Shared project `.mcp.json` effects on Claude Code and Pi are disclosed before
   confirmation; selection does not imply isolation between hosts sharing an entry.
4. Guidance is installed only at verified targets; Amazon Q explicitly reports
   unsupported guidance while MCP remains installable, and skill-only hosts
   never claim a managed instruction write. Remote skill-only
   installation/repair is idempotent, preserves existing CLI
   skills, deduplicates shared roots (including order-independent local/remote
   union in preserve mode), and does not authenticate or rewrite MCP
   during a guidance-only repair. Existing four-skill behavior stays covered.
5. Staged human/JSON output and all follow-up commands preserve the route, scope,
   selected IDs, and `--no-guidance`. Manual work cannot be reported as success.
   Desktop-only and mixed selections in both MCP profiles print the exact
   directory link, make no Desktop setup writes or local auth calls, preserve
   legacy config, and report external action without claiming it is installed,
   connected, or authenticated. Staged explicit requests stop at the same handoff.
6. Uninstall handles both connections and preserves existing guidance rules.
7. Targeted init tests, `bun test`, `bun run typecheck`, `bun run build`,
   `bun run smoke:cli`, and `bun run smoke:mcp` pass. Extend CLI smoke coverage
   for remote flags/help and staged envelopes without writing real user config.
   Run `bun run plugins:generate` and `bun run plugins:check`; explain every
   generated diff. Built smoke suites are additionally required if smoke launch
   behavior or CI product-validation changes.
8. Use an isolated temporary home/project for real host configuration checks;
   never mutate actual user setup or print config/auth responses containing
   credentials. Record host versions, tested scopes, and whether evidence covers
   config, OAuth, discovery, or a successful tool call. Report unavailable live
   validation honestly; do not equate a unit fixture with a verified host.
   Local-only remote setup/detection must also work with malformed unrelated
   network environment values, without constructing network/auth dependencies.
9. Run targeted `bun run agent:e2e` guidance canaries (`express-router.md`,
   `package-overview-vulnerabilities.md`, full profile) with Claude and Codex when
   practical and inspect tool calls, final response/confidence, metrics, and
   isolation violations. These verify MCP-skill guidance, not all host installs.
   The onboarding workload is stateful/manual and currently dry-run-only; never
   run it against the user's real configuration as an automated gate.
10. Shared TOML setup/removal preserves unrelated comments/formatting, siblings,
    BOM/CRLF and semantic settings across standard, dotted, inline, descendant,
    array-table and case-variant forms, with malformed/no-write and idempotency
    coverage. User and project routes share the primitive. Remove obsolete
    printTomlRewriteWarnings and the cli-commands.md statement claiming
    project TOML comments are lost.
11. Durable documentation is accurate; add a feature fragment with `githits:
    minor`, `@githits/mcp: none` unless the verified implementation changes that
    package's public behavior. No MCP release/deployment is needed for CLI-only
    configuration changes.

## Documentation, public skills, and cleanup

Do not publish behavior-dependent onboarding skill changes on this feature
branch. The repository's public Agent Skill lifecycle requires those edits on
the release branch after the matching CLI behavior is included. Record the
precise onboarding update in the plan/backlog for release preparation: offer
the remote profile, preserve its flag in staged commands, skip CLI auth for
hosted targets, and follow per-host verification instructions. This is a release
dependency, not permission to omit the update indefinitely. The canonical MCP
guide does not require changed bytes for a different installation transport.

At the phase boundary, compare the plan with current `origin/main`, resolve
changed host contracts, and replace proposed evidence with actual results.
The user authorized implementation through `$orchestrate`. This does not
authorize merge, release, publish, or deploy.
Keep it through implementation review. Once the last implementation PR has a
clean review, move durable facts into implementation docs and any still-open
release/compatibility work into `docs/plans/open-backlog.md`, then delete the
plan in that PR as its final commit before merge.

## Review record

Internal technical design preflight completed on 2026-10-20. Direction: profiles
first is simpler and fits the confirmed first-menu/default decisions. Findings:

- Accept: clarify Desktop's missing guidance target. The survey and manual
  outcome explicitly say no skill/instruction installation is verified there.
- Subsequent user direction: replace custom-connector/manual MCP setup with the
  existing GitHits directory link, for both MCP profiles. Preserve legacy local
  config during init and retain explicit uninstall cleanup; no connector-state
  API or automation is proposed. The complete plan review includes this decision.
- Subsequent wording clarification: label the existing route local CLI where
  supported, remote otherwise, with local opt-in experimental support. No new
  scope, architecture, phase, or acceptance criterion is introduced by this
  wording clarification, so it does not require a separate review round.
- Subsequent user decision: remote is now the preselected interactive default.
  This supersedes the earlier choice to preserve the interactive default and
  is covered in the complete plan review. Subsequent user approval preserves
  existing transports in no-selector staged/`--yes` runs, while new targets stay
  local-first and explicit selectors migrate.
- Clarify, without expanding requirements: uninstall still removes the existing
  four-skill set. The user's preservation decision answered an installation
  question; changing uninstall ownership would be an additional product change.
  The contract and remote-then-uninstall regression case are now explicit.

Completed-plan internal technical review (2026-10-20): direction sound. Accepted
the guidance-capability clarification: only verified skill/instruction targets
are installed; Amazon Q remains MCP-only and reports unsupported guidance. This
is a bounded UX correction, not a reason to block remote configuration or add
unverified roots. Added the outcome-based regression criterion. The reviewer
reported no other technical findings; live OAuth remains a validation limit.
The plan now enters one external Claude plan-review round. Earlier preflight
was design preparation and is not the completed plan review.


### External plan review round 1 — accepted findings and closure

Direction sound; no new infrastructure requested. User approved the round-1
recommendation: no-selector unattended runs preserve an existing valid
transport. Reviewer demonstrated that strict local-first scans would mark
remote entries needs_setup and migrate them back to stdio, breaking working
host OAuth setups under ordinary old-onboarding runs. Recommendation sent to
user: preserve existing transport; explicit profile requests migrate. Worst
realistic outcome is loss of working GitHits connectivity until local login or
remote reconfiguration; trigger is ordinary no-flag staged/yes use; estimated
remedy is bounded selection/probe logic plus explicit migration selectors, no
persistent metadata. The user's “Yeah, that makes sense” approves this
recommendation and the explicit `--remote`/`--local` migration selectors.

Accepted technical findings:

- Remote matching exactness -> local-only equivalence fallback -> checked
  setup-handlers equivalence and expected native shapes -> specify matching
  expected/transport fields while tolerating host-owned extras, with serialized
  Q and Cline fixtures. This prevents ordinary UI/CLI normalization from causing
  unnecessary overwrite; small shared matcher change, no new subsystem.
- Q reverse migration -> name-only check and native add lacking force -> checked
  local Q descriptor and upstream global-map remove/add contract -> specify
  transport-aware global JSON check and explicit native `--force` replacement,
  with both directions tested. Bounded setup failure under an explicit local
  request; no retry or fallback is needed.
- Shared project selection wording -> Claude/Pi own the same entry -> checked
  both project factories -> document/disclose shared-file impact instead of
  promising impossible isolation. No new config location or framework.
- Stale section references -> draft accumulation -> bounded reread of the whole
  plan -> references now point to the detailed contracts above, and earlier
  design history no longer claims the current detailed contracts are unresolved.

No code has been dispatched or changed. The approved behavior is now reflected
in mode resolution, scans, guidance, JSON, follow-up commands, and acceptance
criteria. Rerun internal and external plan review before implementation. The
external reviewer remains in this worktree for round 2.


### Internal closure review before external round 2

The internal reviewer re-read the full revised plan and accepted preserve mode,
explicit migration selectors, Q reverse migration, host-owned extras, shared
Claude/Pi disclosure, and guidance capability wording. Its only remaining note
was stale survey wording for Windsurf/Cline/OpenCode. Applied that wording fix by
pointing all three rows to their already-verified detailed resolution. No
blocking technical issue remains from the internal pass.

### Coordinator source finding during round 2

Native Codex remote add violates the config-only unattended invariant because
it awaits browser OAuth. Bounded sibling scan: existing ExecService has no
default timeout and captures output, so waiting is real; local add uses stdio
and does not enter that OAuth branch. Codex remote user/project both now use
the existing TOML executor, honoring CODEX_HOME, then report host login. Native
add remains for config-only host commands; no timeout workaround or new auth
mechanism. The external reviewer received this source evidence during round 2.

### External plan round 2 adjudication

Direction sound; round-1 closures verified. No tests run by reviewer.

- F1 accepted: Codex native remote add blocks OAuth; replacement global TOML
  edits lose comments with current serializer. User asked targeted comment-
  preserving edit (recommended) versus existing writer with warning. Same
  CODEX_HOME resolver must serve checks and writer. After the user objected to
  this data loss, adopt targeted preservation in the shared format handler.
- F2 accepted: Q RemoveArgs has long-only name. Fix positional uninstall to
  `mcp remove --name githits`; add exact invocation test. Bounded sibling scan:
  both add/remove target global map; add --force already included.
- F3 accepted: label Plain MCP local-first/no guidance. Existing explicit menu
  intent and staged selector semantics unchanged.
- F4 accepted: state/test per-path union for mixed preserve-mode profiles on
  shared skills root; preserve existing dedup rather than new state.
- F5 accepted: close Qwen/Antigravity survey wording with verified native
  shapes and remove contradictory phase unknowns sentence.
- Coordinator sibling source check: Gemini native HTTP add is config-only but
  serializes current typed URL shape, so user check accepts it and legacy
  httpUrl. This prevents repeated repair after successful native add.

Next external round is round 3, after decision, internal closure review, and
full revised plan read. No fourth plan review round is permitted.

### Internal closure review before external round 3

Completed full revised plan check: round-2 closure plus shared TOML source-span
preservation contract, no new dependency or infrastructure. The targeted edit
fixes a verified pre-existing project-config loss as well as the new user route.

Internal round-3 closure check accepted the revised design with one added
case: descendant server tables/arrays are owned by the replaced/removed entry.
Added explicit merge/remove fixtures with env subtable plus siblings/comments.
Severity calibrated as a normal-input correctness gap, not a direction blocker.

### External round 3 and readiness

Direction sound; reviewer reported low code-contract findings and minor wording.
This round was not clean, so no fresh-context reviewer was spawned. Three-round
limit reached; coordinator closes in-scope findings and proceeds without round4.

- F1 assessed and rejected after measured fixture spike: runtime package
  @decimalturn/toml-patch3.3.1 (MIT, no dependencies,216KiB installed) passed18
  but failed6 of24 merge/remove operations. It deletes unrelated sibling
  comments during normal removal/descendant migration and changes a quoted
  sibling trailing comment. Exact evidence `bun run spike.ts` at
  /tmp/githits-toml-patch.okO5vf; fakefixtures only. No repository dependency
  added. Keep bounded source edits with existing parser validation.
- F2 accepted: match every case-variant GitHits key plus descendants, as existing
  merge/remove do. Preserve BOM; added explicit fixtures and contract.
- Doc nits accepted: explicit TOML acceptance criterion and obsolete warning/docs
  removal; completed internal-check wording; clarify Luna Claude parser slice.

All plan notes adjudicated; no unresolved product decision. Plan reviewer
released and terminal closed (ctx_895f2db44fb1, closed_agent_terminal).
Implementation will receive a fresh code-review scope and validation.


## Implementation evidence (2026-10-20)

Implemented the profile resolver in the existing host catalog, native HTTP
shapes/probes, preserve-mode scans, per-profile guidance, host-owned auth
completion instructions, Desktop directory handoff, and shared project notice.
The shared TOML handler now edits selected server spans and validates semantics
with the existing parser; no dependency or infrastructure was added.

- Full `bun test`: 6,642 pass, one environment failure across 252 files. The
  failing `eval/agentic/upgrade-review/score.test.ts` selected Python 3.9 and
  could not import stdlib tomllib.
- `PATH="/opt/homebrew/opt/python@3.13/libexec/bin:$PATH" bun test
  eval/agentic/upgrade-review/score.test.ts`: 1 pass, 0 fail.
- `bun run typecheck`, `bun run plugins:generate`, `bun run plugins:check`,
  `bun run build`: passed. Ten generated assets checked; no generated diff.
- `GITHITS_AUTH_STORAGE=file bun run smoke:cli` and
  `GITHITS_AUTH_STORAGE=file bun run smoke:mcp`: passed unauthenticated
  contracts; live queries skipped with AUTH_REQUIRED. Unqualified default
  runs encountered UNKNOWN from the ambient auth-storage path, so they are
  not claimed as clean authenticated runs.
- `bun run smoke:cli --mode unauthenticated`, `bun run smoke:cli:built`,
  `bun run smoke:mcp:built`: passed. Remote flag/conflict/detect smoke cases
  use disposable host directories and never install into real host configs.
- Isolated real Codex 0.163.0 user setup: source init --remote --install-agents
  codex-cli --no-guidance --json returned success, native codex mcp get
  recognized streamable_http at the hosted URL, unrelated annotated source
  was unchanged, and malformed HTTPS_PROXY did not affect config-only setup.
  No OAuth or tool-discovery claim. Test wrote only temporary fake config.
- TOML preservation suite: 37 pass, including supported multiline inline
  tables, inline comments and trailing commas discovered during validation.
- Full guidance canaries completed with both Claude Code 2.1.304 and Codex
  0.163.0 on express-router and package-overview-vulnerabilities. Exact command:
  `bun run agent:e2e --agent <claude|codex> --surface mcp --server local
  --guidance-profile full --workload eval/agentic/workloads/express-router.md
  --workload eval/agentic/workloads/package-overview-vulnerabilities.md
  --out .agent-eval/remote-init-<claude|codex> --timeout 300`. Dedicated
  Codex eval home/dedicated Claude Keychain credential injected only into child
  environment. Both reports success 2/2, final answers high confidence, zero
  CLI calls and validation violations. No isolation-violations file generated.
  Actual tool-calls/finals/metrics inspected: Codex seven completed MCP calls
  (search/list/grep, pkg_info/pkg_vulns), no failed calls; durations 234.785s and
  22.641s. Claude observed four MCP call starts (list/grep, pkg_info/pkg_vulns),
  durations 220.446s and 26.344s; adapter does not expose logical completion or
  token/cost telemetry. No answer-quality grade was run; harness success does
  not establish answer quality. Artifacts under ignored .agent-eval directories.
  No real onboarding workload run.

The public onboarding skill remains unchanged under its release-only lifecycle;
the precise release-preparation update is in docs/plans/open-backlog.md. Native
authentication/discovery was not exercised for all 18 automatic hosts. Exact
configuration fixtures are not evidence of successful host OAuth/tool calls.
Implementation/code reviews, stable delivery commits, and draft PR remain.


### Conformance preflight closure

Fresh Luna reviewer completed one bounded pass. Accepted stale SSH example:
added --local to the local OAuth command and checked nearby examples/options.
It also marked full-suite/canary evidence pending; canaries are now complete
as recorded above, and the full suite passed 6,643/6,643 with Python 3.13. No other
plan/docs/interface mismatch was reported. Internal correctness review completed; adjudication below.


### Internal correctness review adjudication

Direction sound. One auth finding rejected on verified baseline/test evidence:
reviewer proposed deriving local auth from every selected host when a new
remote target is combined with an unchanged local target. Existing HEAD uses
MCP targets needing setup for exactly this decision. Regression
init.test.ts 'bases staged mixed auth on MCP targets, not guidance-only repairs'
explicitly selects new remote Cursor plus canonical local OpenCode and asserts
no local auth factory and managed_by_cursor. The finding incorrectly described
that regression as both already configured. Expanding auth to unchanged local
hosts contradicts the existing no-auth guidance-repair contract. Clarified the
plan/output docs; no code change warranted. Rejected findings stay rejected
without new evidence. No accepted internal code finding remains.

Latest full command
`PATH="/opt/homebrew/opt/python@3.13/libexec/bin:$PATH" bun test`: 6,643 pass,
0 fail, 26,583 assertions, 252 files. Latest typecheck/build also pass. Targeted
changed-file lint errors fixed (two assignment expressions); remaining warnings
are mostly parser-validated source-index non-null assertions, not errors.


### External code review round 1 closure (in progress)

Direction sound, three low code findings plus minor release notes. No final
fresh-context reviewer ran because the round had code findings. All accepted:

- F1 -> hosted-only early return skipped shared-root/local-auth helpers. Reused
  existing user/project shared-root and auth helpers inside remote next steps.
  Bounded scan found unchanged remote agents missing from next-step inputs;
  now include those reporting targets for --yes only. The combined suite caught
  an over-broad inclusion of unselected configured Cursor; restricted it to
  --yes while ordinary selection continues excluding unselected auth steps.
  Remote readiness is not claimed. Three
  interactive tests (user Cline, project OpenCode, mixed preserve --yes with
  skipped local login) pass; user/project disclosure and concrete login proved.
  Initial worker cases mistakenly used staged installAgents; corrected and
  rerun on the actual interactive path before acceptance.
- F2 -> staged text printed host instructions only in host-managed-only branch.
  Print remote instructions alongside local auth for mixed MCP work. Sibling
  check of JSON/text partial-failure paths also restricts human host instructions
  to successful/already-configured outcomes. Two staged tests pass: preserved
  remote Cline + fresh local OpenCode; failed remote Cursor + successful local
  OpenCode (no failed-host auth instructions, local login retained).
  The first failure-test brief used an impossible preserve-mode Cline write;
  worker correctly rejected it and coordinator switched to remote-only Cursor.
- F3 -> native Gemini add honors GEMINI_CLI_HOME, newly introduced file probe
  assumed OS home. Match native settings base (empty/unset default, absolute or
  relative override; correct platform path semantics); projects unchanged.
  Verified upstream gemini-cli76e4d7c0 utils/paths.ts20–26 and config/storage.ts
  50–75, matching reviewer evidence. GitHits source read timed out after300s;
  primary raw GitHub source was used as fallback. Targeted 'Gemini user settings home override' suite:11pass0fail,60assertions
  across both profiles, POSIX empty/unset/absolute/relative and Win32 relative;
  every case also checks project path unchanged. Reset the override in isolated
  descriptor fixtures and constrain it to disposable init smoke home.
  Sibling guidance-base handling has a broader pre-existing custom-home gap;
  scope question offered. After an opportunity to reply, keep the current
  MCP-probe fix bounded unless the user chooses to expand it. Precise evidence,
  affected consumers and acceptance are now in docs/plans/open-backlog.md.
  Do not silently add a host-home framework.
- F4 -> independent user-visible behavior omitted from notes. Added separate
  patch fragments for respecting disabled config-file entries and the corrected
  Amazon Q --name uninstall invocation; CLI only, MCPpackage unchanged.

Round2 prerequisites complete: F3 proof, affected/full tests/typecheck/build/
smokes, internal full-delta closure clean. Coherent fix commit follows. No fourth
code round permitted.

Affected final suite: `bun test src/commands/init/agent-definitions.test.ts
src/commands/init/init.test.ts src/commands/init/remote-init.test.ts`436pass0fail,
1,986assertions. Typecheck passed. Review-fix build and source/built CLI/MCP
smokes passed (file-auth live-capable runs skip AUTH_REQUIRED). A broader test
run before the final --yes restriction was6658pass1fail; its one failure was
the unselected-host regression now passing above. Final full command with Python3.13 on PATH:6659pass0fail,26686assertions,
252files,27.81s. Final typecheck/build passed (build50ms). Internal full-delta
closure review clean: all F1–F4 closures verified, no new actionable findings.
Hosted OAuth/discovery coverage remains the declared integration limitation.


### External round2 and final validation isolation correction

Round2 direction sound; all R1code findings closed. One Low wording finding
accepted: replace only authenticated staged user/project literals with explicit
local CLI auth wording. Existing mixed staged test now asserts local auth and
separate Cursor OAuth instructions (1pass5assertions). R2counts clean after
wording correction under repository policy; no final-check subagent ran in R2
because it reported a finding. Retained ctx_c2b003f48191 /
term_42359071-0ae5-4a20-a7d0-affdabbfe1f4.

User clarified keep Gemini scope bounded and verify actual standard-home
discovery before changing paths. Corrected backlog: a helper-derived override
root does not prove exclusive discovery or a missed-guidance bug. No guidance
path change included. Durable native-config matrix prepared in implementation
docs. Plan retirement was prepared after R2clean, then restored for the new
test-only review below; keep until this final correction is reviewed.

Full final run reproduced a pre-existing startup-test isolation defect:
6658pass1fail; 'warns on newer different guidance...' saw7warnings not1.
Narrow rerun reproduced. Direct runtime proof: settingprocess.env.HOME during
execution changes Nodeos.homedir but not Bun1.3.14 os.homedir here. Existing
withConfigHome changed HOME/cwd but actualFileSystemServiceImpl.getHomeDir
still returned the host home; local real-home newer skills leaked into the
fixture's maintenance scan. Fix only the existing test helper: spy filesystem
getHomeDir to its explicit temporary home and restore finally. No production
path/service change. Re-review as R3 since test implementation changed afterR2.

Final isolation correction evidence: `bun test src/commands/mcp.test.ts`51pass
0fail140assertions; full `PATH="/opt/homebrew/opt/python@3.13/libexec/bin:$PATH"
bun test`6659pass0fail26690assertions252files83.05s. Final internal full-delta
review clean, no actionable findings. Build/pluginscheck/builtCLI+MCPsmokes
passed after literal correction; source file-auth smokes alreadypassed and
unchanged by test helper. Typecheck passed. R3 will review this stable state
and run the one permitted fresh-context final check if otherwise clean.
