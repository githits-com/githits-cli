# Plan: reproducible skill and MCP context measurements

Status: COMBINED GUIDANCE EVALUATION ACTIVE. The controlled loading studies are
complete. The routing description/body candidate is selected; matched PR
baseline/candidate repetitions and Braintrust comparison remain in progress.

## Luna candidate selection and PR comparison (ACTIVE)

The user authorized local Luna checks before selecting the complete description
and body change, followed by three full PR eval repetitions and Braintrust
comparison. Attribution between description/body is not a selection requirement.
Test baseline, the existing router, and a router with a clearer first-action
description using neutral prompts and code/docs follow-ups plus a pinned upgrade.
Use gpt-5.6-luna at low effort to match the named CI suite model, three rotated
repetitions per task. Inspect activation, discovery order, locator/version
preservation, task completion, requests and actual input/cache counters.

The local Luna pilots are excluded: valid object target rejection in the first,
competing global skills and subscription quota exhaustion in the second. No new
wording variant has comparative evidence. Use the previously tested routing
metadata/body, retaining the existing canonical scope/locator contracts. The
production builder owns the guide and the skill embeds it exactly; eval code
owns only measurements. No host API discovery instructions are added.

CI now includes the existing full scenario, alongside discovery and intent.
Historical baseline SHA: `8aa5492760149564496daf84aaa9d9225cf2f6bb`; run
34452621919 completed three attempts. Candidate 1a527a4 was not evaluated:
upstream 53463de removed feedback and changed descriptors, causing conflicts.
Integrated baseline: `1fc2e4247559e6e8b6aaf057abf1e9f9f8b9ffd9`, run
34453944757. Complete three baseline attempts before three router attempts on
the identical new catalog. Candidate skill/guide sizes: 4,515 / 3,984 characters;
baseline: 6,348 / 5,537. Keep the runtime-only upstream appendices intact.
Complete three repetitions for this baseline and the combined candidate under
the same coverage. Record SHA, actual host/model and cell identities; inspect
skill ingestion and compare Braintrust rows by cellId. Historical descriptor-only
rows cannot measure skill effects. Commit/push and PR evals are authorized;
merge, release, hosted deployment and global skill installation are not.

Validation limitation to carry into implementation documentation: the CLI live
suite completes stable coverage then fails the existing experimental resolver
expectation. A direct `expressjs` probe returns the expected site/related targets
at medium confidence, but the assertion requires exact/high. Root score behavior
is outside this guide-only delta; backend diagnosis remains separate work, with
no smoke weakening. Initial MCP live get_example JSON timed out at 60 seconds;
the full 59-step retry passed.

## Routing-format follow-up (COMPLETE)

All 48 fresh runs completed and the payload/order annotations were inspected.
Guide-before-evidence-discovery counts (baseline -> router) were Codex skill
0/6 -> 4/6, Codex bootstrap 0/6 -> 6/6, Claude skill 6/6 -> 6/6, and Claude
bootstrap 1/6 -> 0/6. Codex's successful router-bootstrap sequence cost six
model requests. Full findings, variants, counters and limitations are now in
the implementation document and routing-study artifacts. Production selection
and broader reliability work remain pending; the experiment is complete.

User-authorized question: can a routing skill or routing `quick_start` be read
before discovery of the task's evidence tool, without catalog-print instructions?
The eval fixture owns candidate guidance; production skills and descriptors
remain unchanged until evidence supports a product decision.

Compare four fresh conditions: canonical self-contained skill; routing
self-contained skill; canonical bootstrap-entry skill plus canonical quick-start;
routing bootstrap-entry skill plus routing quick-start. Bootstrap-entry controls
use the same short body requiring quick-start; this is not a no-skill MCP test.
The router is shared between skill and quick-start and preserves the existing
external-content guardrail block. Only quick-start's description changes among
tool descriptors. No ALL_TOOLS-specific instructions are introduced.

Run both pinned hosts, three rotated repetitions, and two fixed tasks (literal
repository grep and package overview): 48 fresh sessions. Inspect native Codex
executions and Claude Skill/ToolSearch calls. A skill read batched with evidence
discovery fails strict ordering even if source code lists the read first.
Quick-start discovery is allowed before bootstrap; any evidence-tool discovery
before its response fails bootstrap ordering. Separate ordering, full-catalog
printing, correct selection, completion and usage. Retain failures and unknowns.

Acceptance: exact variants, workload fixtures, per-run sanitized ordering
evidence and numeric observations are reproducible and documented; report
success counts per host/delivery/workload rather than claiming universal
reliability. Unknowns include initial hidden prompts, model variance and whether
descriptors alone can bootstrap without a skill. These remain explicit limits.
Review this bounded plan update inline under the user's review policy.

## Completed increment

- Offline inventory/replay, safe native/stream usage extraction, production-schema
  fixture MCP server and study preparation commands are implemented.
- Eighteen fresh runs cover both hosts, three skill conditions and three
  repetitions. Codex description hints changed discovery in 3/3 runs; body hints
  were read too late in 3/3. Claude used Skill/ToolSearch in all nine runs.
- Five resumed Codex user turns per condition verified a persistent 7,149-token
  input gap. Claude unpinned resumes changed models; they are retained as
  excluded evidence, alongside pinned continuations with their prior-history
  limitation. Native counters, not ambiguous resume terminal totals, are used.
- Input/output counter reconciliation and malformed-transcript privacy are
  covered by deterministic tests. All facts, raw counter fixtures, limitations
  and reproducible commands live in `docs/implementation/agent-context-loading.md`
  and `eval/agentic/context-loading/`.
- Plan and measurement delta were reviewed inline under the user's single-pass,
  delta-specific review policy. No host-specific public skill fork is justified
  by this cohort; a small conditional metadata instruction is the next candidate.

## Outcome and ownership

Establish what Codex, Claude Code, and Claude.ai expose before discovery, after
skill activation, after tool selection, and across subsequent model requests.
Use repeatable measurements to choose where GitHits guidance belongs without
damaging discovery, correct invocation, or safety.

The existing agent-eval scripts own measurement: reuse their source selection
and isolated launch contracts. A small offline inventory/replay script belongs
beside them, not in the MCP runtime. It must distinguish reproducible content
size from observed provider usage and from assumptions about hidden prompts.
Do not introduce a second agent launcher, proxy, global configuration changes,
host-specific published skill copies, or a tokenizer dependency in the first
increment. Exact characters/UTF-8 bytes and actual recorded usage suffice to
establish the first baseline; a named/versioned tokenizer can follow if needed.

## Verified starting evidence

- The original code-mode discovery printed full matching `ALL_TOOLS` entries.
  Its output reported 31,133 tokens before truncation and omitted 21,133;
  adjacent request input increased by 10,001. These are different measures.
- A known-tool repeat added 1,040 input tokens while reusing bootstrap.
- A fresh Astra-medium child obeyed name/80-character/eight-candidate limits
  and completed a grep. Input grew by 4,282 across discovery, skill loading,
  definitions, bootstrap and result. The report belongs in durable research
  documentation, not only temporary files or the public gist.
- **Installed/canonical mismatch:** the installed MCP skill is a 1,105-character
  stub requiring `quick_start`. Current `skills/githits-mcp/SKILL.md` is 6,396
  Unicode characters and embeds stable guidance, explicitly skipping that call.
  Prior results cannot establish current packaged-skill performance.
- `scripts/agent-eval.ts` has descriptors/full/skills modes and `--target-root`.
  It discards native sessions (`--ephemeral` / `--no-session-persistence`).
  Raw CLI events are not full provider requests. Claude ToolSearch events are
  captured; Codex discovery is currently `not_exposed`.
- `scripts/agent-eval-metrics.ts` normalizes Codex terminal aggregate usage;
  Claude usage is explicitly unimplemented. No general offline context sizing
  tool or multi-user-turn resume driver exists.
- `full` installs project guidance and the MCP skill. `--ignore-rules` skips
  execpolicy files, not documented Markdown instruction loading. Installation
  is not proof of ingestion; verify the exact skill path and returned body.
- The first normal-home Claude probe found the skill but no GitHits MCP tools.
  Preserve it as failed-configuration evidence; use explicit session-local MCP
  configuration for a valid tool-loading probe.
- Claude.ai's names plus 80-character prefixes and full-description search are
  verified user-supplied observations. Existing transcript-derived probe uses
  first-sentence/79-plus-ellipsis rendering. Keep these representations distinct.

## Method and assumptions

Record host/CLI version, actual reported model, effort when exposed, transport,
catalog identity, canonical/installed skill hashes, discovery mode, prompt,
enabled unrelated tools, and evidence source for every run. Keep unknown fields
null. Compare within host/model/configuration first; do not attribute different
host installations or different backend revisions to instruction changes.

Evidence levels: source-verified, provider/CLI documentation, observed trace,
model self-report, user-provided observation, and simulated assumption. Initial
model self-report is useful orientation, not proof of complete request bytes.
Native logs can establish tool output and request usage without establishing
the entire hidden initial prompt. Source behavior must be pinned and cannot be
assumed to match the installed binary merely because names match.

Separate input/context growth, cumulative inclusive input, uncached input,
cache-read input, cache-write input, output, and logical/user/model turn counts.
Deduplicate Claude message usage by message ID: split assistant content blocks
repeat the same usage. Codex inclusive input and Claude additive usage buckets
must not share an unqualified subtraction formula. Missing usage stays unknown.
Do not assign cost without an explicit versioned rate snapshot.

Offline replay reports attributable content, not a full host prompt or billed
tokens. Include skill listing versus body, tool catalog versus selected full
definitions, server instructions, bootstrap, tool output, truncation, and
retention. Sum retained content over requests to expose recurring load. Do not
assume compaction, cache hits, or request count from user-turn count.

## Phase map

1. **Measurement foundation (COMPLETE):** durable evidence ledger, canonical
   inventory, validated replay fixtures, repeatable size/usage reports, and
   initial Codex/Claude Code observations. Dependencies: current source and
   authorized local agent launches. Assumptions: character/byte replay is useful
   without claiming exact prompt tokens. Unknown: hidden initial provider
   payload, availability timing, and Claude registration until explicit rerun.
2. **Controlled guidance experiments (METADATA AND ROUTING COHORTS COMPLETE; BROADER COHORT PENDING):** baseline versus skill-description
   hint versus skill-body instruction, with tools/descriptors fixed; descriptors
   versus self-contained skill isolates bootstrap separately. Dependencies:
   phase 1 instrumentation and valid host setup. Unknowns: activation reliability,
   descriptor-search effects, model variance. No preferred strategy assumed.
3. **Choose and validate guidance placement (PENDING EVIDENCE):** document the
   smallest strategy supported by repeated successful workloads and implement
   any selected canonical changes through existing skill/package lifecycle.
   Dependencies: phase 2. Unknown: whether any host-specific instruction is
   justified. Explicitly resolve that product/maintenance choice before forks.

## Phase 1 implementation and acceptance

- Add `scripts/agent-context-load.ts` with a read-only canonical inventory using
  `getMcpToolDescriptors()`, Zod JSON schemas and `buildMcpQuickStart()`.
  Describe JSON serialization as an inventory format, not Codex's TypeScript
  declaration rendering. Include skill frontmatter/body separately and hashes.
- Add explicit snapshot/replay fixtures under `eval/agentic/context-loading/`:
  approved public metadata and sanitized numeric observations only. No private
  paths, credentials, session IDs, whole system prompts, or unrelated tool dumps.
- Replay explicit lists of content present in each model request, with bounded
  repetition counts. Repeated references count duplicate content; omitted blocks
  are absent. This avoids an inferred lifecycle or state machine. Report
  per-request and cumulative character/byte load. Unknown token sizes remain
  null; actual usage is a separate observed numeric surface.
- Add meaningful tests for delayed loading, repeated admission, removal,
  request-boundary accounting, UTF-8 versus JS/Unicode length, and invalid data.
- Preserve the failed Claude probe, rerun with explicit GitHits MCP, inspect
  activation/discovery/usage, and document whether initial self-report agrees
  with later trace evidence. Do not repair failure by silently changing global
  registration or authentication.
- Maintain `docs/implementation/agent-context-loading.md` as the evidence ledger
  and reproducible command guide. The public gist is a shareable summary, not
  the canonical research store.

Acceptance: fresh runs reproduce inventory and fixture replay offline; tests
pass; recorded token deltas match verified logs; all known host differences and
missing visibility are explicit; ordinary eval metrics keep their semantics.
No production runtime behavior or public guidance changes in this increment.

## Remaining work and why it is separate

- Expand the cohort to grep-to-read, vulnerability/upgrade tools, descriptor-only control,
  smaller models and near-compaction sessions before selecting a production
  metadata/guide change. One fixed grep fixture cannot establish their routing
  or safety behavior; the current increment supplies the required baseline and
  reproducible apparatus, not a claim of universal optimization.
- Establish exact initial provider payload/schema rendering only through a
  verified supported capture surface. Current logs omit parts of those payloads;
  model self-report cannot fill that gap. No credential-bearing proxy is added.
- Diagnose the live stdio grep that remained pending beyond 15 minutes. Its
  connection succeeded; retrieval did not finish and the trace is retained.
  No root cause is established, so fixture latency must not substitute for
  production evidence. This requires a separate bounded transport/service
  investigation, not speculative retries or a production workaround.
- Integrate opt-in trace retention/usage readers into the existing eval harness
  after its scenario/metadata contract is reviewed. Its current terminal-aggregate
  metrics remain unchanged; resumed lifetime counters and Claude provisional
  outputs make an unreviewed adapter change unsafe for historical comparisons.

These items remain here so they are not lost. Transfer them to durable guidance
or a successor approved increment before deleting the plan. No additional
infrastructure, public publication, deployment or global skill installation is
part of the completed measurement increment.

## Phase 2 experiment contract

Use the same literal-grep prompt first, then grep-to-read and a task requiring
another tool family. Test warm subsequent model requests separately from fresh
user turns. Start with paired runs, then at least three repetitions of promising
conditions before claiming reliability. Retain failures and excluded runs with
reasons; do not select only successful traces.

Change one factor at a time: current canonical skill; same skill with a concise
frontmatter discovery hint; same description with discovery instructions in its
body. A hint in the description can act before activation; body instructions
cannot affect discovery that occurred before the body was loaded. Keep a plain
MCP control. Distinguish a supplied user instruction from installed skill text.
Do not leak expected tool names into neutral task prompts.

Acceptance: reports show activation order, selected tools, content loaded,
request counts, token partitions, repeated retained load, correctness and
evidence limitations. Choose candidates by successful task completion and
total attributable cost, not shortest text. Character simulation predicts only
the declared replay, not model choices or unobserved Claude.ai requests.

## Review, delivery, and cleanup

Review this documentation inline under the user's delta-specific review rule;
that overrides the generic planning skill's multi-review workflow. Runtime
measurement changes receive one scoped review if substantive. Run relevant
`bun test`, typecheck/format/lint and build before committing code. Do not run
product smoke/evals merely for a docs-only change; live measurements are the
research work and must be interpreted independently of harness success.

At each boundary update this plan from evidence. Keep durable findings in the
implementation document and fixtures. Delete this plan when all selected work
is implemented, preserving unresolved externally blocked protocol research in
its existing plan rather than expanding this study into Skills-over-MCP work.
