# Unified read

MCP advertises one `read` tool. CLI provides `githits read`; `githits code read`
and `githits docs read` remain compatible commands, marked deprecated in help.

## Locators and ownership

`packages/mcp/src/shared/read-request.ts` owns transport-neutral locator and range
validation. A nonempty `path` selects an exact code file; otherwise `target` is an
opaque documentation locator. Empty optional paths count as omitted. Preserve docs
target bytes, including URL query strings, percent encoding, fragments, and pinned
repository locators. Never infer the source from URL host or file extension, or
retry a failed read against the other backend.

The MCP tool accepts `target`, optional `path`, `start_line`, `end_line`,
`wait_timeout_ms`, and `format`. Targets for code are compact package/repository
strings; the structured code-target object accepted by other navigation tools is
not part of this read schema. Existing target parsers still own package/provider
syntax and exact Git revision handling.

The tool in `packages/mcp/src/tools/read.ts` injects both existing services and
routes to the source-specific read operations. Backend APIs and fetched fields are
unchanged. CLI uses the same locator interpretation but its own actions, retaining
complete, content-only output for pipes. JSON result models remain source-specific.

## Sections, windows, and waiting

- A docs URL fragment with no explicit bounds selects its exact indexed section.
  Do not synthesize line defaults before that backend call.
- Either explicit bound overrides a docs fragment with a page-relative range.
  Returned positions and continuation bounds are absolute page line numbers.
- Docs text displays at most 150 selected lines by default, or 300 with an explicit
  end. Docs JSON retains the full backend selection. Code reads cap before fetching
  at 150 lines by default or 300 with an explicit end, including JSON.
- Validate requested positive integer bounds and their order before applying caps;
  a fractional end beyond the cap must not silently become a valid bounded request.
- `wait_timeout_ms` is the code indexing wait: default 30,000 ms, range 0–60,000,
  including explicit zero. Docs validates supplied values but does not forward them,
  since its backend operation has no wait parameter. INDEXING retains backend
  metadata and supplies recovery through the same read locator. No client retry loop.

CLI uses `--lines` for either source. Code also retains `--start`, `--end`, path
suffix ranges and `--repo-url`/`--git-ref`. Docs rejects the code-only bound/ref
options. CLI `--wait` has the same applicability as the MCP wait parameter.

## Ask compatibility

The backend Ask contract still returns typed `code_read` and `docs_read` source
pointers. `projectAskReadSources()` beside the local MCP Ask adapter projects these
into callable `read` pointers before text or JSON rendering. Code preserves its
target/path/bounds; docs maps `page_id` to `target`. All other response metadata is
preserved and the original backend response is not mutated. URL and clarification
responses pass through unchanged. This keeps MCP and backend rollouts independent.

Core service consumers still see the backend contract. CLI Ask continues to display
backend-provided argv because the legacy CLI commands remain functional; do not
parse or rewrite opaque command strings. Catalog names belong to the MCP adapter,
not the backend service parser.

## Migration and future extension

```text
code_read(target, path, ...) -> read(target, path, ...)
docs_read(page_id, ...)      -> read(target=page_id, ...)
githits code read ...        -> githits read ...
githits docs read ...        -> githits read ...
```

MCP removes the legacy names rather than registering aliases. Clients must
rediscover the tool catalog. Local clients get the change with the CLI; hosted
clients require an @githits/mcp release, remote-mcp dependency adoption, and a hosted
deployment. Those are separate authorized delivery actions.

Symbols are future-only: a future `symbol` selector beside `target` and `path` can
select a backend-resolved symbol, with explicit bounds overriding semantic
selection. No symbol parameter is currently advertised or implemented. Git `#ref`
and file paths are not repurposed to encode symbols. The backend must own symbol
identity, revision resolution, and ambiguous/overloaded definitions when added.

## Public skill release follow-through

The stable MCP quick-start and embedded `skills/githits-mcp/SKILL.md` guide change
with this implementation under the exact-parity exception. Other public skills are
served from main before npm release and must follow their release-boundary policy.
At the release containing unified read, update `skills/githits-code/SKILL.md` and
`skills/githits-code/references/code-and-docs.md`: prefer `githits read`, retain
legacy commands only as compatibility guidance, and replace both retired MCP
mappings with `read` (target alone for docs, target plus path for code). Also audit
`skills/githits-package` and references for read examples. Regenerate/check plugin
assets after canonical skill edits. This release-boundary work is intentional;
CLI alias removal and working symbol lookup require separate product decisions.

## Validation evidence

Pre-change static descriptor measurement at 9697466: code_read 4,855 bytes,
docs_read 2,088 bytes, pair JSON array 6,946 bytes; stable catalog 15 tools /
56,176 bytes; quick-start guide 4,821 bytes. Measurement serializes name,
description, `z.toJSONSchema(z.object(schema))`, and annotations. These are byte
counts, not token estimates or runtime performance measurements.

After-change measurement with the identical serializer: read array 2,444 bytes
(64.8% smaller), stable catalog 14 tools / 51,605 bytes (4,571 bytes smaller),
and guide 4,845 bytes (24 bytes larger). The combined catalog-plus-guide is
4,547 bytes smaller. No before/after agent-token or runtime-speed claim is made.

The source-specific read regressions, CLI routing, Ask projection, catalog,
quick-start parity, smoke assertions, and deterministic eval fixtures are covered
by the test suite. Build, smoke, package and agent-eval evidence follows.

Deterministic validation: `bun test` passed 4,608 tests / 16,193 assertions;
`bun run typecheck`, changed-file Biome lint/format, `bun run build`,
`bun run plugins:generate`, `bun run plugins:check`, and
`bun run validate:packages` passed. Full-repository lint exits successfully with
pre-existing warnings in the unchanged repository-target parser.

Agent evals used local descriptor-only guidance and unchanged neutral workload
prompts. No isolation-violation artifacts were emitted (the harness writes them
only when violations are detected).

| Run (under `.agent-eval/runs/`) | Observed behavior | Reported metrics |
| --- | --- | --- |
| `2026-09-11T08-47-31-123Z` — Codex discovery | All three workloads reported success/high confidence, but no GitHits tools were used; raw traces show web tools and local file probes. This is not evidence of read behavior. | 81.4s; 69,180 uncached input, 104,448 cached input, 2,081 output tokens; estimated base-rate cost $0.01842216. |
| `2026-09-11T08-47-31-300Z` — Claude discovery | Read Express source lines 55–90; followed docs search with target-only `read` of the Express route-handlers fragment. The direct Flask workload used WebFetch instead. All answers reported high confidence. | 156.5s; logical counts and token/cost metrics unavailable in the Claude adapter. Raw tool results confirmed successful source and section content. |
| `2026-09-11T08-50-34-348Z` — Codex intent | Using the existing harness `--intent-profile githits`, read Express lines 55–90 and the unchanged Flask fragment with no bounds; Flask returned only absolute lines 81–93. Both answers reported success/high confidence. | 60.4s; six logical MCP calls, including two reads; 79,375 uncached input, 194,048 cached input, 1,564 output tokens; estimated base-rate cost $0.02163276. |

Commands used `bun run agent:e2e --agent <agent> --server local
--guidance-profile descriptors`, repeated `--workload` for `code-read-window.md`,
`docs-search-followup.md`, and `docs-fragment-read.md`. The Codex intent run added
`--intent-profile githits` and selected only code-read-window and docs-fragment-read.
`tool-calls.json`, raw results, `final.json`, metrics, and validation artifacts were
inspected. Self-reported confidence is not a quality grade; no grading stage or
matching pre-change agent baseline was run.

Live validation:

- Stable `bun run smoke:mcp` assertions passed, including unified code/docs reads.
  Its subsequent experimental Ask request timed out at 60 seconds, so the complete
  command exited unsuccessfully; live Ask projection is not claimed verified.
- `bun run smoke:cli` passed unauthenticated checks but stopped in unrelated
  `pkg deps npm:express --issues` with a backend HTTP 502 before the read checks.
- Targeted authenticated CLI probes then verified `read` and both legacy commands
  produce identical JSON and content-only output for Express 5.2.1 source lines
  55–90 and the Flask routing fragment; verbose output also passed. The fragment
  selected absolute lines 81–93 with no supplied bounds.
- `bun run smoke:cli:built` and `bun run smoke:mcp:built` passed, including stable
  and experimental registration/auth handling under Node.

These external live-suite failures remain evidence limitations, not suppressed
assertions or added retries. Unit tests cover Ask projection, including metadata
preservation and no mutation of backend results.


## Implementation review closure

One Opus review ran on 2026-09-11, followed by coordinator verification; no second
review round was requested, following the user's single-pass policy.

- Accepted missing CLI authenticated-command registration. The shared metadata
  table naturally owns auto-login eligibility, continuation text, and JSON auth
  failure handling. Added `read` to that table; regressions exercise interactive
  success/continuation and failure envelopes, alongside both legacy commands.
- Accepted stale CLI recovery hints/help. Both new and legacy code reads now direct
  retries to `githits read`; content and JSON result contracts remain unchanged.
  Scanned the command/helper and parity assertions for the same stale name.
- Accepted current-policy documentation drift and repeated search-description
  wording. Updated current references while retaining historical measurements and
  release-boundary public skill work.
- Rejected the optional suggestion to replace explicit zero waits in indexing
  recovery. Zero remains an intentional nonblocking mode; the recovery preserves
  caller intent, and the guide already explains using indexing estimates to choose
  a longer wait. No new retry policy or automatic waiting was added.

Six bounded Luna dispatches handled mechanical follow-ups, peripheral text,
neighboring descriptors, guide parity, catalog assertions, and final wording.
Coordinator retained routing/validation, CLI/Ask integration, auth closure, and
verification. No worker rework or interrupts were needed. Initial eval inventory and auth
metadata omissions were coordinator scope gaps; closure tests also caught a
dynamically assembled legacy CLI name and missing smoke rejection for the new
CLI syntax. All were fixed and covered by the final passing suite.

CI exposed missing explicit types on the exported read schema/descriptions:
bunup warns locally but fails declaration generation under `CI=true`. Added
explicit Zod schema and string annotations without changing the wire schema or
runtime. `CI=true bun run --cwd packages/mcp build`, typecheck, and the 36-test
read/catalog/eval subset pass; public-package validation was repeated in CI mode.


### Luna low and Haiku follow-up (2026-09-11)

Tested commit `e71f771` with `gpt-5.6-luna --reasoning-effort low` and
`haiku` (provider reports `claude-haiku-4-5-20251001`). Each ran all three
workloads in both descriptor-only discovery and the existing GitHits-intent
profile: 12 cells total, one sample per model/profile/workload. Workloads ran with
`--concurrency 2`; prompts and runtime were unchanged.

| Model / profile | Source window | Exact Flask fragment | Docs search follow-up |
| --- | --- | --- | --- |
| Luna low / discovery | Local probes, then web | Web | Web |
| Luna low / intent | `code_files` then `read`, lines 55–90 | `search` then target-only `read`, lines 81–93 | Used sufficient docs-search snippets, no unnecessary read |
| Haiku / discovery | Local probes, then `read`, lines 55–90 | WebFetch, after correcting its native tool call | WebSearch and WebFetch |
| Haiku / intent | Direct `read`, lines 55–90 | Direct target-only `read`, lines 81–93 | `search` → ambiguous-section read error → narrower `search`; answered from returned snippets |

Raw results confirm both models used the unified schema correctly for code and
fragments under GitHits intent. No retired MCP names, structured read targets,
wrong source dispatch, or accidental fragment bounds appeared. All 12 final
responses self-reported success/high confidence and no isolation violations were
detected; these statuses alone are not an answer-quality grade. Subsequent manual
inspection checked the six intent answers against retrieved content: both source
answers identify lazy initialization and the exact caseSensitive/strict settings;
both fragment answers cover automatic route ordering and canonical redirects;
both docs answers describe method/path/callback handlers supported by search
content. No material answer error was found in those six samples. There is no
formal automated quality score or reliability claim from one sample per cell.

Discovery remains a separate limitation: Luna chose no GitHits tool in any of
these three neutral cells, and Haiku chose it only for code. The earlier statement
that Luna used “no tools” was too broad: `tool-calls.json`/logical metrics count
GitHits calls, whereas raw stdout also records native web and local tools.

Observed locator-consistency gap: Haiku copied
`https://expressjs.com/en/5x/guide/routing/#routing` verbatim from search result 7.
Read returned `DOCUMENTATION_SECTION_UNRESOLVED` with `reason: ambiguous`.
The adapter forwarded the supplied target unchanged; this does not demonstrate a
unified-schema failure. Backend search/read section consistency needs investigation
in the backend repository. No backend change or client fallback was attempted in
this evaluation task; the recovered answer does not make the failed locator valid.
Evidence is in the Haiku intent docs-search-followup raw stdout, including both
search responses and the read error.

Run directories under `.agent-eval/runs/`:

- Luna discovery: `2026-09-11T09-16-57-232Z` — 0 GitHits calls; 53,864 uncached
  input, 73,984 cached input, 1,135 output tokens; base-rate estimate $0.01361448.
- Luna intent: `2026-09-11T09-17-25-748Z` — 8 GitHits calls; 74,820 uncached
  input, 297,984 cached input, 1,518 output tokens; base-rate estimate $0.02274528.
- Haiku discovery: `2026-09-11T09-16-57-224Z`.
- Haiku intent: `2026-09-11T09-17-37-611Z`.

Haiku aggregate token/cost and logical-call metrics remain unavailable in the
harness adapter; raw tool-use and matching result records were inspected instead.
No before/after comparison is claimed. This follow-up changes evidence only.

### PR eval locator correction (2026-09-11)

PR evals at `338d02d` exposed an existing `code_files` text-header bug:
`indexedVersion` contained the served Git SHA, but the formatter appended it to
`npm:express@...` as though it were a package version. Luna copied this invalid
locator, received `VERSION_NOT_FOUND`, then tried object-valued `read.target`
recovery calls before switching to the required compact repository string.

The list-files formatter owns the copyable header target. It now prefers the
backend's served repository URL and exact commit (or served ref), using the
existing repository-target formatter. Package-only responses use the served
package version or explicitly requested version; untyped `indexedVersion` and
`resolvedRef` fields are never converted into package versions. JSON retains all
original resolution fields. This fixes locator production without broadening
`read.target` or inventing a version from a Git ref. Regression coverage uses the
observed Express payload and parses the emitted locator back into a code target.

Initial PR runs `34594029426`, `34594060140`, and `34594062207`, attempt 1,
were exported to Braintrust but ran concurrently and encountered 72 HTTP 429
responses. Preserve these experiments as contaminated execution evidence, not
as clean before/after measurements. Only one 429 came from `global-example`;
others affected package and navigation workloads. Attempt 2 of the first run
completed without observed 429s and exposed the locator bug above. Remaining
repeats were stopped when the user requested correction before further runs.
Future comparisons exclude `global-example` as requested, match 44 existing
scenario/workload cells, and report the two added fragment cells separately.
All comparisons use `main-r34592914082-a1` at `74e316e` as the baseline.

Correction validation: 4,712 unit tests passed; typecheck and CI-mode public
package validation passed. The live Express payload rendered
`github:expressjs/express#dbac741a49a5a64336b70c06e85c2e2706e36336`; passing that
locator unchanged to `read` returned the requested application-source lines
55-90, including both router options. Source and built CLI/MCP smoke checks
cover unauthenticated handling and MCP registration. The 11-line formatter
delta was reviewed inline under the small-change review policy.

### First corrected PR run and repo-doc text correction

Run `34595208046` at `65799f5` exported experiment
`pr-388-r34595208046-a1`, linked to the same main baseline. Excluding the
user-unwanted `global-example`, inspected traces had no HTTP 429s, no isolation
violations, and no recurrence of package targets containing a Git SHA. Discovery
used GitHits for Express routing (six successful reads). The remaining errors
included three backend timeouts, an invalid explicit `version: "latest"`, and a
rewritten Express URL that mixed one page with another page's fragment.

Two more read failures exposed a text/JSON inconsistency: search text showed
`pypi:flask@3.1.3 docs/design.rst:83-93`, while JSON's working follow-up used the
opaque repo-doc target
`github:pallets/flask@22d924701a6ae2e4cd01e9a15bbaf3946094af65/docs/design.rst`.
Luna invented a combined package/path docs locator and got `NOT_FOUND`.
The search text renderer now uses the existing `documentationReadLocator`
selection for repo docs, exposing its unchanged target with separate
`start_line`/`end_line` bounds. Repository code locations, semantic preferred
reads, ANSI styling, and JSON follow-ups retain their contracts. This is a
small renderer correction, reviewed inline; no new locator parser or backend
fallback is introduced. A regression uses the observed Flask result, and a live
read copied from the rendered row returned the expected lines 83-93.

Repo-doc correction validation: 4,713 tests, typecheck, CI-mode public-package
validation, and source/built CLI/MCP smoke checks passed. The formatter's exact
locator and separate bounds were also checked against the live docs read endpoint.
