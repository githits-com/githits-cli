# Plan: Keep GitHits skill guidance available and transportable

## Problem and expected outcome

The original `githits-mcp` Agent Skill told an agent to call `quick_start` even
though loading the skill was already a reliable way to put the same shared
guidance in context. That added an avoidable discovery and tool-call round trip
on chat surfaces. It was an overcorrection made while moving shared MCP
instructions into `quick_start` for clients that expose only tools.

Phase 1 made the installed skill self-contained: it carries the exact stable
guide returned by `buildMcpQuickStart()` and tells the agent not to call
`quick_start` for the normal GitHits MCP surface. `quick_start` remains the
fallback for plain MCP clients that do not load the skill, with exact parity
enforced by repository instructions and a deterministic test.

Later, when Skills over MCP has a public client contract, serve that same
self-contained skill over MCP without changing its behavioral content.

## Correction to the previous plan

The previous plan deferred all work until SEP-2640 or a client contract became
public and proposed composing the stable guide into the served resource at MCP
server startup. That boundary was too broad.

Embedding the already-released stable guide in the existing filesystem/plugin
skill is independently useful and does not depend on Skills over MCP. Once the
skill is self-contained, a future MCP resource should transport the canonical
skill unchanged rather than maintain a second runtime composition path.

## Verified baseline before Phase 1

- Before Phase 1, `skills/githits-mcp/SKILL.md` was the canonical authored MCP
  skill. It was 1,105 characters and told the agent to call `quick_start` once
  unless the returned guide was already in context.
- `buildMcpQuickStart()` is the stable public/remote guide and currently returns
  4,285 characters. It owns routing, public-only scope, target syntax, compact
  output, citations, reference-first behavior, and the shared external-content
  posture.
- `buildLocalMcpQuickStart()` appends runtime-dependent guidance for enabled
  experimental tools and optional issue reporting. With both current tools and
  experimental reporting it returns 5,832 characters. Public skills must not
  advertise that block because the tools and reporting policy may be absent.
- `quick_start` was released in `githits` and `@githits/mcp` 0.11.0 and remains
  present in 0.11.1. Updating the skill now does not describe unreleased MCP
  behavior.
- Before Phase 1, `src/skills-packaging.test.ts` enforced the opposite
  contract: the skill was under 2,000 characters and named the `quick_start`
  call. Its intended absence checks for stable guide detail and
  external-content posture did not match the guide's wording and therefore did
  not prove those details were absent.
- The agent eval harness already has the relevant comparison:
  `--guidance-profile descriptors` exposes MCP tools without the skill, while
  `--guidance-profile full` installs `githits-mcp` alongside the same MCP
  server. Tool calls are recorded for inspection.
- Root `skills/**` is the only authored public skill surface. Generated plugin
  manifests package it directly; no host-specific copies exist.
- The working group still marks SEP-2640 in review, and no general public Codex
  Skills-over-MCP contract is documented. MCP transport remains later work.

References:

- https://modelcontextprotocol.io/community/working-groups/skills-over-mcp
- https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640

## Target architecture and ownership

```text
packages/mcp/src/mcp/instructions.ts
       buildMcpQuickStart() -- stable guide owner
                    |
                    | exact parity test
                    v
skills/githits-mcp/SKILL.md
       activation + stable guide + CLI fallback
              |                    |
              | current hosts      | future transport
              v                    v
filesystem/plugin skill       MCP skill resource

Plain remote MCP without a loaded skill -> quick_start -> same stable guide
Plain local MCP may append runtime-specific experimental guidance
```

`packages/mcp/src/mcp/instructions.ts` remains the canonical owner of the
stable guide because it already composes shared guardrail constants and
enforces tool-registration parity. `skills/githits-mcp/SKILL.md` is the only
authored public skill and carries an exact copy under a terminal
`## Quick-start guide` heading. A test extracts everything after that heading
and compares it byte-for-byte, excluding only the file's final newline, with
`buildMcpQuickStart()`.

This deliberately uses a checked copy rather than a new generator. The guide is
small, changes infrequently, and both surfaces are human-reviewed Markdown. A
generator, template language, marker parser, or runtime filesystem dependency
would add machinery without improving the enforced contract.

## Compatibility boundary

### Normal stable surface

When `githits-mcp` is loaded, the agent reads the stable guide directly and
must not call `quick_start` for bootstrap. It proceeds to the relevant evidence
tool, including through chat-based tool search. When the skill is not loaded,
the `quick_start` description and tool behavior remain unchanged and continue
to provide the same guide once per session.

An installed filesystem/plugin skill is a snapshot, while `quick_start` comes
from the currently connected server. If an older installed guide conflicts
with current tool descriptions, the descriptions are authoritative; the skill
may call `quick_start` to resolve a material mismatch. This is an exceptional
upgrade path, not normal bootstrap behavior.

### Local experimental surface

The static skill does not include `resolve_target`, `code_diff`, experimental
privacy wording, or opt-in issue-reporting policy. Add one narrow exception to
the skill: if any GitHits tool exposed to the agent has a description beginning
with `Experimental`, call `quick_start` before the first GitHits tool so the
runtime-specific appendix is loaded. Do not promote experimental tool names or
guidance into the stable guide itself. The description prefix is the detection
contract and is asserted for every local experimental tool.

This cannot preserve every `report_tool_issues = "all"` prompt. A lazy
tool-search client may expose only a stable descriptor for a stable-only task,
so the agent has no transport-neutral signal that experimental tools and their
runtime appendix exist. Phase 1 accepts that optional feedback prompt may be
missed in that case; stable tool selection and evidence behavior are unchanged.
Preserving the prompt completely would require an always-visible runtime signal
or a `quick_start` call in every skill-loaded session, both outside this small
parity PR and the latter contrary to its purpose.

This exception preserves runtime-appendix behavior when an experimental
descriptor is exposed, while retaining current ownership. Removing it would
discard that runtime guidance; embedding the appendix would advertise phantom
tools and policy to most users.

## Phase map

1. **Phase 1 — installed `githits-mcp` carries the stable guide and skips the
   redundant bootstrap call (COMPLETE, 2026-08-28).**
2. **Phase 2 — supporting MCP clients can discover and load the same canonical
   skill as a verified MCP resource (PENDING EXTERNAL CONTRACT).**
3. **Phase 3 — hosted deployment and mixed local/MCP-origin UX are validated in
   released clients (PENDING PHASE 2).**

## Phase 1: self-contained skill and enforced parity

### Status

COMPLETE — 2026-08-28

### Completion record

Phase 1 delivered the first small parity increment:

- `skills/githits-mcp/SKILL.md` now embeds the exact stable
  `buildMcpQuickStart()` guide from
  `packages/mcp/src/mcp/instructions.ts` under one terminal
  `## Quick-start guide` heading.
- A loaded skill skips normal `quick_start`; plain MCP retains the
  `quick_start` fallback. Current tool descriptions remain authoritative.
  A material stale-snapshot mismatch or an exposed local descriptor beginning
  with `Experimental` may still trigger `quick_start` before the first
  GitHits evidence tool for runtime-specific guidance.
- `buildLocalMcpQuickStart()` runtime appendices, experimental tool names,
  privacy wording, and issue-reporting guidance remain outside the public
  skill. Every enabled local experimental descriptor is contract-tested with
  the `Experimental` prefix.
- `src/skills-packaging.test.ts` enforces exact stable-guide parity,
  terminal-section structure, bootstrap wording, fallback/exception wording,
  external-content posture, and exclusion of local appendices.
- `AGENTS.md`, the internal maintenance/release skills, and implementation
  docs now own the same source/parity and delivery-path rules. The root
  `githits` patch fragment records `@githits/mcp: none`.
- The bounded lifecycle rule is explicit: backing stable behavior,
  `buildMcpQuickStart()`, and the embedded skill copy land in the same PR to
  `main`, then ship in the next applicable release cycle. This does not
  create a deploy-first or two-PR flow; runtime local appendices stay excluded.

Decisions retained for later phases:

- `packages/mcp/src/mcp/instructions.ts` remains the stable guide owner;
  the skill copy is checked byte-for-byte, ignoring only its final newline.
- No generator, protocol implementation, host-specific copy, or new runtime
  mechanism was introduced.
- Lazy discovery can hide optional `report_tool_issues = "all"` guidance in a
  stable-only workflow. Phase 1 documents and accepts that bounded limitation;
  it does not add an always-visible runtime signal or restore a normal
  `quick_start` call.
- Phase 2 remains gated on a runnable client with an official generalized
  Skills-over-MCP contract. Phase 3 remains a later hosted/client rollout.

Commits:

- `c5a208c` — `fix: make MCP skill self-contained`
- `3992868` — `docs: define MCP skill parity lifecycle`
- `b3965b8` — `docs: clarify MCP skill release exception`

Deterministic evidence:

- Targeted skill/instruction/local-server cohort:
  `bun test src/skills-packaging.test.ts src/commands/mcp-instructions.test.ts packages/mcp/src/mcp/instructions.test.ts packages/mcp/src/mcp/local-server.test.ts` → 35 pass, 0 fail.
- `uv run --isolated --with pyyaml python /Users/jpl/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/githits-mcp` → `Skill is valid!`.
- `bun run plugins:generate` → 10 assets, no generated diff.
- `bun run plugins:check` → 10 validated.
- Full `bun test` → 3,321 pass, 0 fail, 10,667 expect calls across 183
  files.
- `bun run typecheck`, `bun run format:check`, `bun run lint`, and
  `bun run build` → all passed.
- Smoke suites were not run: Phase 1 changed only skill content, tests, and
  documentation; no MCP/CLI/runtime/tool behavior changed.

Qualitative evidence:

- Isolated OpenCode descriptors
  `.agent-eval/runs/2026-08-28T09-31-44-931Z` called `quick_start`;
  success/high usefulness, no instruction issues.
- Isolated OpenCode full
  `.agent-eval/runs/2026-08-28T09-33-04-161Z` loaded the skill and skipped
  `quick_start`; success/high usefulness, no instruction issues.
- OpenCode skills
  `.agent-eval/runs/2026-08-28T09-34-09-494Z` and Codex skills
  `.agent-eval/runs/2026-08-28T09-35-12-073Z` used the githits-cli fallback;
  both succeeded with high usefulness and no instruction issues.
- Codex descriptors
  `.agent-eval/runs/2026-08-28T09-21-46-481Z` called `quick_start`;
  Codex full `.agent-eval/runs/2026-08-28T09-22-51-854Z` and Claude full
  `.agent-eval/runs/2026-08-28T09-26-24-284Z` skipped it. These are
  diagnostic under the documented local guidance-isolation limitations.
- The first OpenCode full run inherited local GitHits experimental
  configuration and correctly called `quick_start` under the
  `Experimental`/runtime-appendix exception. The first OpenCode skills run
  inherited a globally configured MCP. Acceptance reruns used one isolated
  temporary `XDG_CONFIG_HOME` while preserving normal auth; neither initial
  trace was an implementation failure.

Phase 1 acceptance is complete, including the documented lazy-discovery
limitation for optional `report_tool_issues = "all"` guidance. Phase 2 and
Phase 3 remain pending with their reviewed external-contract gate and rollout
boundaries below.

## Phase 2: transport the canonical skill over MCP

### Status

PENDING EXTERNAL CONTRACT

### Entry gate

Start Phase 2 only when all of the following are true:

1. A target client publishes official, generalized Skills-over-MCP support in
   a runnable release or public beta. A deleted announcement, unreleased PR,
   private orchestrator integration, or the Codex-specific `codex_apps`
   `mcp/skill` seam does not qualify.
2. The exact generalized contract is public and versioned: extension
   identifier, client/server negotiation behavior, skill discovery and lookup
   methods, result schemas, resource mapping, and any integrity fields are
   inspectable in documentation, released source, or released SDK types.
3. That client contract does not contradict the accepted/current MCP extension
   specification. Any mismatch is reported before coding rather than hidden in
   a compatibility shim.

Before merging Phase 2, reproduce discovery and loading against that runnable
client with a minimal server or the GitHits implementation. SDK convenience
wrappers are not required: the installed TypeScript SDK already exposes the
extension capability map, raw request handlers, and standard resources needed
for a narrow adapter.

### Expected outcome

A supporting client discovers `githits-mcp` and loads the same canonical
self-contained skill through MCP, applying manifest or integrity checks if the
final contract defines them. The transport does not recompose or fork the
stable guide.

### Assumptions

- No draft transport shape is assumed to survive the entry gate. The
  implementation follows the accepted/public client contract verified there.

### Unknowns or product decisions

- Final generalized method/result shapes and negotiation behavior.

Resolve them through the entry gate before detailing or implementing this
phase. Approval presentation, same-name origin UX, hosted deployment, and
multi-client support remain Phase 3 rollout evidence rather than Phase 2 entry
requirements.

### Dependencies

- Phase 1 merged.
- Every Phase 2 entry-gate condition satisfied.

### Acceptance criteria

- The MCP resource bytes equal the canonical `skills/githits-mcp/SKILL.md`.
- Manifest frontmatter, UTF-8 size, and digest match those exact bytes if the
  final contract carries those fields.
- Unsupported clients retain normal MCP tools and `quick_start` behavior.
- A runnable target client discovers and loads the exact canonical skill before
  merge.
- No server `instructions`, general skill registry, dynamic catalog, cache,
  directory reader, or obsolete draft compatibility layer is introduced.

Tactical file and schema detail will be added after phase-boundary
reorientation against the final external contract.

## Phase 3: hosted rollout and client UX

### Status

PENDING PHASE 2

### Expected outcome

The hosted server serves the skill, and direct, guided, and plugin installs are
validated in every released supporting client. The support matrix records
origin display, approval, refresh, same-name local/MCP behavior, lazy tool
discovery, and absence of the redundant `quick_start` call.

### Assumptions

- Phase 2 produces a released `@githits/mcp` capability consumable by the
  separately deployed hosted server.

### Unknowns or product decisions

- Whether any verified host packaging format can safely omit its filesystem
  copy once MCP transport is available.

Do not remove filesystem skills without that evidence and a separate product
decision.

### Dependencies

- Phase 2 released.
- Hosted-server repository dependency update and deployment.

### Acceptance criteria

- Production discovery/read content and any contract-defined digest match the
  released canonical skill.
- Supporting clients load the guide once, skip `quick_start`, and discover the
  needed evidence tools through their normal chat UX.
- Same-name skills remain origin-safe; no local skill is silently shadowed or
  removed.

Tactical rollout detail will be added after Phase 2 reorientation.

## Security, performance, and rollback

- Security improves on the skill-loaded path because the empirically validated
  external-content posture is present without relying on another tool call.
- The context cost increases by the stable guide's 4,285 characters only when
  the skill is loaded. That is intentional; it replaces, rather than adds to,
  the normal `quick_start` result. Descriptor-only clients pay no extra cost.
- Rollback is a normal revert of the skill/docs/test/instruction changes. The
  `quick_start` fallback remains intact throughout, so no protocol or data
  migration exists.

## Non-goals

- Changing stable or experimental quick-start wording.
- Removing or deprecating `quick_start`.
- Promoting experimental tools or runtime issue-reporting policy.
- Generating `SKILL.md` or moving shared guidance ownership.
- Serving `githits-code`, `githits-package`, or `githits-onboarding` over MCP.
- Implementing any draft Skills-over-MCP protocol in Phase 1.

## Phase boundaries and plan cleanup

After each phase merges, use `$next-steps` against current `origin/main` before
detailing the next phase. At every reorientation, re-evaluate all Phase 2 entry
conditions against current public client and MCP evidence. Record observed eval
and client evidence, revise assumptions, and stop on contradictions.

After Phase 1, transfer the durable guide-parity and delivery-path contract to
the listed implementation docs and maintainer instructions. After all phases,
move remaining transport and rollout facts into implementation documentation
and delete this plan.
