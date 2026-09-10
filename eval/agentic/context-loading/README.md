# Context-loading measurements

Read the [findings and evidence boundaries](../../../docs/implementation/agent-context-loading.md)
before comparing numbers. This adds a small research companion to the existing
agent-eval harness. It does not change published tools, install global skills,
modify authentication, or infer model behavior from text size.

## Offline checks

From the repository root:

```bash
bun test scripts/agent-context-load.test.ts eval/agentic/context-loading/fixture-server.test.ts
bun scripts/agent-context-load.ts sizes
bun scripts/agent-context-load.ts usage eval/agentic/context-loading/fixtures/codex-compact-child-usage.json
bun scripts/agent-context-load.ts replay eval/agentic/context-loading/replays/canonical-skill.json eval/agentic/context-loading/fixtures/canonical-inventory.json
bun scripts/agent-context-load.ts replay eval/agentic/context-loading/replays/canonical-bootstrap.json eval/agentic/context-loading/fixtures/canonical-inventory.json
bun scripts/agent-context-load.ts replay eval/agentic/context-loading/replays/codex-compact-catalog.json eval/agentic/context-loading/fixtures/codex-observed-inventory.json
bun scripts/agent-context-load.ts replay eval/agentic/context-loading/replays/codex-full-catalog.json eval/agentic/context-loading/fixtures/codex-observed-inventory.json
```

Omit the last inventory argument to use current canonical content. Save
`inventory` output locally to freeze another candidate. Hashes identify the
exact content measured; the two checked-in inventory fixtures represent
different catalogs/renderings and must not be interchanged.

Replay rows are explicit per-model-request content lists. They can model
delayed loading, persistent content, duplicate reads, removals and additional
requests. They exclude every unspecified component. Token counts are null;
characters/bytes are exact for the declared content, not full provider prompts.

## Reproduce the live loading/selection study

The fixture server uses production descriptions and argument schemas, with a
fixed labeled grep response. It never contacts GitHits or an OSS backend. It
supports fixed grep and package-overview workloads, not general retrieval.
The response is deliberately held fixed; optional output-shaping arguments do
not model full production semantics. Inspect actual arguments and do not use
this fixture to judge those semantics or general answer quality.

1. Record `codex --version` and `claude --version`; compare them with
   [protocol.json](protocol.json). Agent login must already work. No credential
   copying is part of this procedure.
2. Stage a new directory under `.agent-eval/`:

   ```bash
   bun eval/agentic/context-loading/prepare.ts .agent-eval/context-study-new
   ```

   The preparer refuses to overwrite an existing study. It copies three skill
   variants per host, creates one explicit fixture MCP config, and writes
   `study.json` with exact argv/cwd for 18 runs in rotated condition order.
   It does not launch agents. Both hosts now explicitly request the protocol's
   models; also verify the reported model. Original fresh Claude runs used its
   default, but unpinned resumes changed models, so reproduction pins it.
   Codex also requests the recorded effort. Skills and system instructions from the host
   still matter: this is controlled payload variation, not a hermetic prompt.
3. Execute each `commands[].argv` with `commands[].cwd`, saving stdout/stderr
   into that command's directory. Use a bounded run timeout and preserve all
   failed runs. A simple sequential local driver is:

   ```python
   import json, pathlib, subprocess
   study = json.loads(pathlib.Path(".agent-eval/context-study-new/study.json").read_text())
   for run in study["commands"]:
       directory = pathlib.Path(run["cwd"])
       with (directory / "stdout.jsonl").open("w") as out, (directory / "stderr.txt").open("w") as err:
           subprocess.run(run["argv"], cwd=directory, stdout=out, stderr=err, timeout=300, check=True)
   ```

   Run this only against a freshly prepared directory. The example stops at
   the first failure; preserve and diagnose it instead of restarting over the
   same artifacts. Explicit fixture-only MCP config is essential: a successful
   call to a globally configured live server is a contaminated run.
4. Inspect the Claude `system/init` MCP status and model, Skill content and
   ToolSearch operations. For Codex, locate the native session identified by
   that run's `thread.started.thread_id`, then inspect its execution code and
   tool outputs. Stdout/normalized tool lists omit relevant catalog operations.
   Do not dump whole session files or unrelated tool definitions into a model.
5. Export only numeric observations from the selected run:

   ```text
   bun scripts/agent-context-load.ts observe claude <selected-stdout.jsonl> > <local-observations.json>
   bun scripts/agent-context-load.ts observe codex <selected-native-session.jsonl> > <local-observations.json>
   bun scripts/agent-context-load.ts usage <local-observations.json>
   ```

   `observe` exports model identity and counters only, never prompts, paths,
   IDs or tool arguments. It requires complete input/cache counters. Claude message IDs
   deduplicate split content blocks internally. Codex input includes caches;
   Claude cache fields are additive to `input_tokens`. Historical fixtures
   preserve each convention explicitly. Provisional per-request output is null;
   the verified terminal output total is preserved separately. No dollar estimate is inferred.

## Measure subsequent user turns

Resume repetition 1's baseline and description sessions by their locally
recorded IDs. Explicitly pin the original model/effort and use the same cwd and MCP configuration. Codex
accepts `codex exec [original options] resume <id> <prompt>`; Claude accepts
`claude -p <prompt> --resume <id> [original options]`. Do not use `--last`.

Send the protocol's `warmTask` five times in succession. Each asks for one
already-retrieved path/line without tools. Verify each turn made exactly one
model request and no tool calls before interpreting a terminal turn aggregate
as one request. Even a single-request resume can return lifetime cumulative
usage in Codex; always verify against native request counters. A resumed run
with extra reasoning/tool requests also needs the native trace. Retain the
pre-resume observations separately, and reject unrequested model switches.

Compare both first-turn overhead and recurring input/cache partitions. More
discovery requests can increase a short task's cumulative input even when less
content remains for later turns. Do not infer the cache policy or exact billing
rate from content retention alone.

## Fixture and artifact policy

- `fixtures/`: immutable public metadata snapshots and the earlier numeric
  child observation. New source measurements use new snapshots or current
  inventory output, not silent edits to historical evidence.
- `observations/`: one numeric record per request and sanitized study summaries.
  These are descriptive observations, not pass/fail expectations for future
  model behavior.
- `replays/`: explicitly labeled counterfactual content-retention scenarios.
- `protocol.json`: exact task, hint, variant transform, ordering and versions.
- Raw CLI/native traces stay local in ignored storage. Never publish complete
  home configuration, credentials, private source or full session transcripts.

The deterministic tests validate measurement arithmetic, missing-data handling,
Unicode sizes, repeated content, split-message deduplication and fixture schema
parity. Agent outcome/routing reliability is a separate repeated live measure.

## Routing-format follow-up

Stage `bun eval/agentic/context-loading/prepare-routing.ts .agent-eval/routing-study-new`.
Use the sequential driver above with that study's `study.json`. It prepares 48
commands: two hosts, two workloads, three repetitions and four conditions:

- `skill-baseline`: canonical skill and bootstrap.
- `skill-router`: routing description and self-contained routing skill.
- `bootstrap-baseline`: canonical skill description plus a short entry body
  requiring the canonical `quick_start` guide.
- `bootstrap-router`: routing skill description, the same entry body, and the
  routing `quick_start` description/response.

Both routing conditions use the same guide from `routing-guide.ts`; all other
tool descriptors stay canonical. Neither bootstrap condition represents a
client without a skill. The candidate is a combined organization change, not
an isolated estimate of the effect of each sentence. Its complete safety block
is preserved. The fixture now also returns a labeled npm:zod package overview;
both responses are fixed and do not establish current public-source facts.

Save exact staged variants and host versions with each study. Preserve the
selected host's condition order when scheduling: the observed follow-up used
one sequential worker per host, with the two hosts running concurrently. The
simple driver above preserves each host's order but runs the hosts serially.
Inspect the selected native/stream trace and record events for successful skill/quick-start
loads, bootstrap discovery, evidence discovery and evidence calls. Assign
Codex calls to their native token-count request boundaries; assign Claude split
content blocks with the same message ID to the same request. Inspect returned
ToolSearch references as well as its query: selecting bootstrap and evidence
together admits evidence definitions before bootstrap has been read.
Claude's Skill tool result can only say that the skill is launching; confirm
the separate synthetic user message actually contains the staged skill body
before attributing a subsequent decision to it.

`assessRoutingOrder()` in `routing-order.ts` evaluates these trace-audited events.
It requires the guide to load in a strictly earlier model request. A skill read
and catalog search in one execution fail, as do bootstrap and evidence calls
generated in the same request. Bootstrap discovery itself is allowed before
bootstrap loads. Missing observed discovery remains unknown, not a success.
This reducer checks annotated evidence; it is not a general JavaScript parser
or automatic proof that arbitrary host traces are complete.

Compare success counts by host, delivery and task, alongside inclusive input,
cache partitions and model-request counts. Do not pool the two tasks' token
sizes or treat one successful route as reliability across unrelated workloads.
