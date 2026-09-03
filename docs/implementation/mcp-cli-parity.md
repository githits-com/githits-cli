# MCP ↔ CLI Parity

## Purpose

Users and agents should be able to cross the surface boundary without
learning a new request or error contract. Parameter names can differ per
surface convention. Shared request defaults and structured error code,
retryability, and non-remediation details are aligned; documented
surface-specific defaults plus host-owned recovery prose and actions remain
surface-native exceptions.
Human/agent default rendering may differ from JSON envelopes: MCP tools
default to compact `text-v1` where available, while CLI has human
terminal output and `--json`. Structured parity is enforced through CLI
`--json` and MCP `format: "json"`.

Smoke coverage runs through `scripts/mcp-smoke.ts` and `scripts/cli-smoke.ts`.
The default `bun run smoke:mcp` and `bun run smoke:cli` commands launch source
through `bun run dev`, verify unauthenticated behavior, and use inherited local
credentials for the live corpus when available. The MCP invariants live in
`packages/mcp/src/smoke-test.ts` and are exported as
`@githits/mcp/smoke-test` so remote MCP servers can reuse the same validation.

PR CI also runs `bun run smoke:cli:built` and `bun run smoke:mcp:built` after
both public package builds. Their Bun harnesses launch the product as
`node <absolute dist/cli.js>` using argument vectors, never shell command
strings. These modes remove token variables, select isolated file auth and
config roots, disable advisory update checks, and point GitHits service URLs at
reserved `.invalid` hosts. CLI built smoke verifies the exact top-level command
set from root help plus JSON/terminal auth behavior. MCP built smoke lists tools,
exercises the static `quick_start` guide, probes unauthenticated behavior, and
requires the exact stable `EXPECTED_MCP_TOOLS` cohort plus a
separate local-only experimental cohort launched with the hidden session
override. The experimental cohort also checks its local `quick_start` guide and
unauthenticated tool envelopes; it never changes the public smoke constant or
submits feedback. One CI step applies a combined two-minute timeout and logs
each harness timing summary and selected launch vector.

The suites intentionally avoid exact-output snapshots because backend ranking
and release metadata can change. They assert durable UX invariants instead:
server/command startup, registered commands and tools, auth handling, compact
default text, parseable JSON opt-in, MCP-native hints, CLI terminal affordances,
and JSON envelope shape. When adding or changing a dual-surface tool, update the
shared MCP smoke runner and CLI smoke script if the covered UX contract changes.

The dual-surface tools today are:

- `get_example` ↔ `githits example`
- `search_language` ↔ `githits languages`
- `feedback` ↔ `githits feedback`
- `search` ↔ `githits search`
- `search_status` ↔ `githits search-status`
- `code_files` ↔ `githits code files`
- `code_read` ↔ `githits code read`
- `code_grep` ↔ `githits code grep`
- `pkg_info` ↔ `githits pkg info`
- `pkg_vulns` ↔ `githits pkg vulns`
- `pkg_deps` ↔ `githits pkg deps`
- `pkg_changelog` ↔ `githits pkg changelog`
- `pkg_upgrade_review` ↔ `githits pkg upgrade-review`
- `docs_list` ↔ `githits docs list`
- `docs_read` ↔ `githits docs read`
- `resolve_target` ↔ `githits resolve` *(config-gated, local-only)*
- `code_diff` ↔ `githits code diff` *(config-gated, local-only)*

The local smoke runners execute these cohorts independently in source and
built modes. CLI experimental runs use a temporary opt-in config. MCP
experimental registration and live runs use the hidden session override,
which forces the local tools on and reporting off without reading host
experimental policy. Scoped temporary roots preserve inherited environment
credentials but do not copy host file-auth state; authenticated live
validation is conditional and skips with `AUTH_REQUIRED` when unavailable.
Public/remote smoke remains stable-only.

### Phase 3 evaluation record

Claude and Codex each completed the experimental-resolution-follow-up,
experimental-code-diff, and `express-router` regression workloads successfully.
All six runs rated the usefulness of the result as helped: Claude rated the
three workloads high/high/high, and Codex rated them medium/high/high. The
execution gate is complete with the following findings, not issue-free status:
both agents received zero fuzzy candidates for `lodahs` from `resolve_target`;
stable `code_read` indexing retries exceeded the estimate before succeeding
later; and the removed-package security error was ambiguous. These are
external/backend findings, with no client-side fuzzy fallback or other client
claim of resolution. No feedback was submitted. The local `code_diff` text-v1
patch preview truncation was fixed to mark the 320-byte display bound and point
to JSON for the full returned patch, while preserving backend omission limits.

Targeted post-fix `experimental-code-diff` reruns then succeeded for Claude in
59.4s and Codex in 42.2s. Both rated usefulness as helped with high confidence;
each reported zero `toolIssues` and zero `instructionIssues`. This validates
the bounded-preview and JSON recovery guidance fix. It does not change or claim
to resolve the external/backend findings above.

The final instruction compaction reduced the enabled experimental block from
1,650 characters / 245 words to 861 characters / 116 words while retaining the
exact disabled baseline. Claude and Codex then reran both experimental workloads
and the `express-router` regression; all six succeeded and rated usefulness as
helped with high confidence. Claude exposed one schema UX gap by trying brace
expansion in `path_glob`; the field now states the supported single-glob grammar.
A focused Claude rerun then completed CodeDiff in two calls with zero tool or
instruction issues. The resolution/security-holder findings above remained and
are still classified as external/backend behavior rather than compaction
regressions.

The 0.10.0 release-readiness rerun on 2026-08-19 repeated all three workloads
for both agents. All six succeeded and rated GitHits as helpful; Claude reported
high confidence for all three, while Codex reported medium/high/high. Both
`code_diff` runs and both stable `express-router` regressions completed without
tool or instruction findings. The resolution workload reproduced the known
zero-candidate and opaque security-holder errors. Codex additionally observed
that the removed `npm:lodahs@0.0.1-security` source coordinate was unavailable
and symbol search did not find `chunk` even though `code_files`/`code_read`
located it. These remain package/source backend findings: the client preserves
the typed evidence and does not invent fuzzy fallbacks, removed-package
semantics, or symbol matches. Fixing them requires backend ownership and is not
part of the local experimental-tool release.

### Increment 5C production replay (2026-08-31)

Authenticated source CLI and local MCP smoke passed after PkgSeer deployed
candidate `nameSimilarity` and package-scoped certified-artifact
`codeAvailable`. Both surfaces returned `npm:lodash` for `lodahs` with
`nameSimilarity` approximately `0.400000006` and `npm:lodash-es` at
`0.333333343`; verbose human output rendered 40% and 33% plus the coarse
lexical-support qualification, while default text omitted both. Both modes kept
positive indexed-snapshot labels without rendering negative availability or a
trailing readiness disclaimer. `loadsh` kept `npm:lodash` first at 27%
while later candidates carried 40% and 63%, confirming that the client preserves
backend order rather than reranking by lexical similarity. Its MEDIUM result
remained non-actionable under the unchanged confidence/security gate.

The production CLI/MCP matrix also covered:

- typo `expres` -> MEDIUM `npm:express`, and an artificial unique missing name
  -> the normal empty result;
- `codex` with package and repository preferences -> repository best in both,
  with preference changing candidate order only;
- Maven/package `guava` -> `maven:com.google.guava:guava`, ahead of the former
  `com.github.ben-manes.caffeine:guava` displacement;
- `ua-parser-js` and `event-stream` -> current exact package candidates with
  `CLEAR` latest-version malicious status despite their historical malicious
  releases;
- npm-scoped `lodahs` and `loadsh` -> no `npm:lodahs` or `npm:loadsh` removed
  registry-security identities in either candidate list, so no continuation to
  those identities was exposed;
- repository aliases `angularjs` -> `github:angular/angular.js` and `reactjs` ->
  `github:react/react` without client alias synthesis.

Finally, `code files npm:lodash --json` resolved and served commit
`4f0b76e2eca13de1c1fe8b4305abc1f7d63f4b86` with `freshness: current`. That code
command response, not resolver `codeAvailable`, establishes the exact served
artifact.

After the compact-output revision, authenticated source CLI smoke passed all 93
stable and experimental steps, including default, verbose, and JSON resolution.
Source MCP smoke stopped before its resolver cohort because the unrelated stable
`get_example` call exceeded MCP's fixed 60-second timeout; the same production
call took 118-174 seconds in the successful CLI run. Direct authenticated MCP
default, verbose, and JSON resolution passed. Targeted Claude and Codex resolver
evaluations both continued into code tools and completed successfully without
interpreting omitted availability evidence as a follow-up prohibition.

Targeted local-server agent evaluation then ran the experimental resolution and
stable `express-router` workloads with both Claude and Codex. All four workloads
succeeded without CLI fallback or instruction findings. Claude rated both high;
Codex rated resolution medium and `express-router` high. Codex made one
recoverable repository-path miss before reading the indexed package path, which
does not concern resolver evidence. Claude's suggestion to surface the removed
`npm:lodahs` identity was rejected because registry-security-removed identities
must remain undiscoverable and non-actionable. Its concern about a non-ambiguous
MEDIUM result was also rejected: ambiguity describes whether multiple candidates
compete, while confidence and malicious status independently control
continuation. Package-detail and semantic-search observations were
outside this client delta and both agents recovered without resolver changes.

`feedback` is mutating, so smoke coverage exercises registration and
validation/auth paths only. It does not submit fake feedback to the live
backend.

One deliberate exception: `search_status` does not echo the original
structured request because the backend follow-up endpoint does not
expose the caller's original targets or filters.

Unified `search` evidence is not an exception. Core normalization validates and
normalizes the additive repository locator once, then the shared response
projection and formatter serve CLI `--json`, MCP `format: "json"`, CLI text, and
MCP text. Structured parity includes legacy `filePath` / `startLine` / `endLine`
plus `commitSha`, `repositoryFilePath`, `evidenceRange`, `indexedRange`, and
relation-aware `symbolContext`; equal ranges remain distinct in JSON. Text
parity uses one repository-hit header shape with the focused evidence range in
the locator and a differing definition/indexed range after the qualified title.
The single structured `followUp` is MCP syntax on both JSON surfaces and prefers a
proven definition at the exact served repository identity, with the 300-line
MCP read cap applied without changing the true structured definition range.

## Rule IDs

Rule IDs are cited from parity tests in file header comments so the
test suite anchors the doc.

### `PARITY-NAMING`

- **MCP arguments** use `snake_case`. They are the wire contract agents
  see; the JSON-schema description is the primary UX.
- **CLI flags** use `--kebab-case`. They are the user-facing surface.
  `allow_partial_results` maps to CLI `--allow-partial` because the CLI
  name reads better as a command flag while preserving the same behaviour.
  `search_status.wait_timeout_ms` maps to `search-status --wait <seconds>`;
  both default to the shared 20-second bounded wait.
- **Public enum values** are lowercase strings on both surfaces
  (`production`, `test`, `summary`, `all`).
- **Service coercion** from lowercase enum values to the internal
  request enums lives in `packages/mcp/src/shared/code-navigation.ts`
  (`toFileIntent`, `toSymbolKind`, `toSymbolCategory`).

### `PARITY-DEFAULTS`

- Both surfaces import defaults from
  `packages/mcp/src/shared/code-navigation-defaults.ts`. They never diverge
  silently.
- Cross-tool defaults (e.g. `DEFAULT_WAIT_TIMEOUT_MS`) live without a
  prefix. Tool-local sentinels live there too so both surfaces translate
  them the same way.
- When a surface fills in a default for the caller, that default value
  is applied at the shared request builder — not at the surface — so
  both surfaces apply defaults at the same point and under the same
  conditions.
- The local experimental pair is a deliberate explicit-default exception:
  CLI `githits code diff` defaults to patch output while MCP `code_diff`
  defaults to `name-status` inventory. Parity tests select the same explicit
  view and request JSON on both surfaces before comparing service params or
  success envelopes. `resolve_target` keeps its shared limit and detailed
  selection defaults.

### `PARITY-EXPERIMENTAL-LOCAL`

- `resolve_target` and `code_diff` are config-gated local CLI/MCP pairs. They
  are absent from the public/remote tool definitions, descriptors, smoke
  inventory, package exports, and Agent Skill surfaces until promotion is
  separately approved.
- Equivalent explicit calls must normalize to identical service params. CLI
  comma-separated registries and MCP registry arrays, CLI repeated intent
  hints and MCP hint arrays, CLI target/range syntax and MCP target/endpoints,
  and surface-specific field names are compared after the shared request
  builders normalize them.
- Explicit JSON success payloads and mapped service-error envelopes must be
  deeply equal. Invalid caller input keeps the stable classification and
  envelope shape; surface-native validation prose is allowed where the CLI
  names a command/flag and MCP names a tool/argument.
- Resolve text uses the same backend-ordered target list and contiguous grouping
  helper on both surfaces. JSON preserves that list without regrouping, marks
  direct versus relation-only entries, and exposes backend relation truncation.
  A shared group evidence plan keeps metrics on each target line: packages own
  downloads/license, repositories own stars/code, sites own docs, and package
  rows retain projected fallbacks when the corresponding related target is
  absent. All additional identities use one `Related targets:` heading.
  Related malicious-package warnings are member-local and do not block the
  matched best target's otherwise safe continuation.
- The shared resolve request boundary recognizes already-canonical package and
  GitHub repository strings through the same compact parser used by downstream
  tools. Both surfaces return the same `INVALID_ARGUMENT` guidance without a
  resolver service call; human-friendly names that the parser does not accept
  continue through normal resolution.
- Text rendering, agent-specific descriptions, and the deliberate default
  view divergence are not parity targets. The MCP default is compact
  `text-v1`. Both resolve text renderers nevertheless use the same pure
  actionability rule: only a non-ambiguous `EXACT`/`HIGH` best result whose
  matching candidate has `CLEAR` or `NOT_APPLICABLE` latest-version
  malicious-content status can emit a direct canonical next action. `AFFECTED`,
  `UNKNOWN`, missing, and future statuses fail closed. `MEDIUM`/`LOW` results
  remain unconfirmed under that rule, while every non-empty list uses the neutral
  `Targets:` heading. Empty results point to spelling or filters rather than
  ranking-only context. Text omits actionable status lines and renders concise
  warnings only for non-actionable evidence; CLI warnings are red while MCP text
  remains ANSI-free. Both text surfaces omit lexical evidence by default;
  CLI `--verbose` and MCP `verbose: true` render nullable `nameSimilarity` as a
  whole percentage and explain that it is coarse lexical support while candidate
  order follows broader backend policy. JSON preserves the numeric fraction.
  Both label positive `codeAvailable` as an indexed package or repository
  snapshot at the candidate's scope. False availability and its counts are
  omitted because they do not decide whether a later code command can resolve
  and serve a commit SHA; JSON remains lossless.
  `code_diff` patch previews are bounded at 320 UTF-8 bytes, label each affected
  file, and emit one aggregate `Next:` recovery, while
  `format: "json"` returns the full patch returned by the backend subject to
  backend limits and content coverage. Parity uses `format: "json"`
  explicitly.

### `PARITY-REQUEST`

- Request construction for a dual-surface tool routes through a single
  shared helper at `packages/mcp/src/shared/<tool>-request.ts`. The helper fills in
  defaults and translates user-facing sentinel values into wire-level
  equivalents.
- Cross-tool helpers (error classification, target resolution) live in
  `packages/mcp/src/shared/` without a tool-name prefix.

### `PARITY-JSON-KEYS`

- Successful CLI `--json` and MCP `format: "json"` payloads, parsed as JSON,
  must `deepEqual` for equivalent inputs. Error parity follows
  `PARITY-ERROR-ENVELOPE`, including its surface-native action exception.
- String-equal is explicitly not the contract. Key ordering,
  whitespace, and trailing newlines are free.
- **No leading-underscore keys.** `warning`, `hint`, and all other
  status fields are plain.
- Empty arrays and default-valued scalars are omitted in favour of
  field absence wherever that does not change agent semantics.
- Initial unified `search` responses include the full compiled request
  echo. Follow-up `search_status` responses intentionally omit that
  echo and return only backend-known fields:
  `{completed, searchRef?, progress?, result?}`.
- Unified `search` is complete-by-default (`allowPartialResults: false`).
  An incomplete response may still carry an atomic interim result when every
  runnable target/source pair is serveable. `allow_partial_results` /
  `--allow-partial` additionally permit a serveable subset while other pairs
  remain unavailable; both forms carry `results` plus the `searchRef`.
- Completed empty search JSON retains zero-result source/target context;
  healthy source status remains suppressed for non-empty success. Text advice
  is renderer-only and never replaces structured JSON.

### Search output parity

CLI human `search` / `search-status` and MCP `search` / `search_status` default
`text-v1` use one shared formatter. The presentation model owns target groups,
readiness, trust limits, and action selection; the text renderer owns wording,
wrapping, hit anatomy, and ordering. Callers provide ANSI enablement,
surface-native action syntax, and an optional output width. CLI supplies its
current terminal width; MCP uses the formatter's 80-column default. The order is
an outcome headline carrying count/breakdown, lifecycle, readiness, and
pagination when applicable; one compact `Sources: <target> - <sources>` row for
ordinary completed current results, with canonical site locators and compact
GitHub revision locators; a source identical to its standalone target is written once.
A sole pinned repository source replaces its less-specific repository target.
An already-pinned repository target remains beside its resolved commit. Compact repository
provenance requires both its URL and commit; documentation without concrete provenance uses
one detailed target block instead. Other non-compact results likewise use one block per
requested target; target-local state/recovery and global warnings; the separate ranked hit
list; and at most one final `Next:` action.

`PENDING`, `INDEXING`, and `SEARCHING` remain distinct. Active empty output uses
`No results yet | indexing | 0/1 ready`; an active response without a snapshot
uses `No result snapshot yet | indexing | 0/1 ready`, with corresponding
lower-case lifecycle labels for other active states. Active result counts use
`interim` when `partialResults` is false and `partial` when it is true. Terminal
or unknown progress retains lifecycle/readiness in the headline, while completed
output omits them. Target rows keep deterministic `using`, `searched`,
`indexing`, terminal/unavailable, `available`, `indexed`, and constraint segments;
exact terminal reasons remain lane-readable, and a target gets at most one
inline `Fix:` or replayable `Try:` line. Site suggestions and indexed alternatives
remain attached to their target and are never selected automatically.

`evidenceNotice` remains exact in JSON and is not rendered as a generic
mutable-evidence slogan. Concrete stale, provisional, pending, and coverage
facts remain grouped under targets; parser/query and structured-constraint facts
appear once below the outcome. Promoted lifecycle warning prose, raw reason
codes, indexing references, and opaque evidence text stay out of default text.
Reissuing the same search is valid and waits on the same underlying work; text
does not emit negative repeat or poll policy directives.

MCP renders `Next: search_status search_ref=... wait_timeout_ms=...`; CLI renders
`Next: githits search-status ... --wait ...`. An active continuation reference
appears exactly once, in that surface-native final `Next:` action; stopped terminal
references are not rendered. Raw diagnostic fields are never rendered.
Search-result follow-ups likewise use
`code_read` / `docs_read` in MCP and `githits code read` / `githits docs read` in
CLI. ANSI-stripped CLI output shares the same hierarchy and wording as no-color
MCP text apart from those supplied command dialects; line breaks can differ
because CLI uses the terminal width while MCP uses the 80-column default.

CLI `--json` output and MCP `format: "json"` output remain the structured parity
boundary: every
result-bearing initial payload and stored `search_status.result` carries the
backend's exact `partialResults: boolean`, including both `false` and `true`;
payloads with no result snapshot omit that field. Full `warnings[]`, source
diagnostics, evidence notices, reason codes, references, and alternative lists
remain available in JSON even when MCP text classifies or bounds them for
readability. The shared JSON parity tests compare these envelopes deeply; only
surface-native follow-up and pagination syntax plus ANSI differ.

### `PARITY-ERROR-ENVELOPE`

- Every error result, on both surfaces, carries
  `{ error: string, code: MappedErrorCode, retryable?: boolean, details?: object }`.
- `code` is mandatory. `UNKNOWN` is a last resort — named errors from the
  GitHits API, code-navigation, and package-intelligence clients map to a
  specific code. API rate-limit metadata is preserved in `details` when
  available. The classifiers are covered in
  `packages/mcp/src/shared/*-error-map.test.ts`; those tests are the enforcement
  mechanism, not a convention.
- MCP error text is always valid JSON. A client that parses
  `content[0].text` on error gets the same envelope shape and structured data as
  CLI `--json`. Client-owned validation messages and path-recovery
  `details.action` are deliberately surface-native: MCP names MCP
  tools/arguments, while CLI JSON names CLI commands/options. Shared request
  builders use natural, surface-neutral prose for semantic validation labels;
  CLI request adapters translate those phrases to flags and CLI syntax, while
  MCP preserves the neutral wording. Changes to either adapter or the shared
  prose must update the corresponding exact assertions and parity tests.
  Terms acceptance is a deliberate host-owned exception: core mapping retains
  neutral `code`, `retryable`, `termsUrl`, and `acceptanceUrl` data; local CLI
  and local stdio MCP add the `githits settings terms accept` command, while
  hosted MCP defaults to an `acceptanceUrl` action. Browser services that
  throw the exported `TermsAcceptanceRequiredError` get the same canonical URL
  remediation, while an arbitrary `Error` remains `UNKNOWN` at that boundary.
  These host-native recovery fields and prose are tested exceptions; they do
  not weaken the shared structured envelope.
- Backend error messages, hints, indexing estimates, available versions/refs,
  and suggested refs are preserved when supplied. Clients do not replace
  specific backend guidance or synthesize target candidates.
- The REST-backed `example`, `languages`, and `feedback` CLI commands preserve
  this envelope for generic transport/backend failures as well as typed auth
  failures. Human mode renders the same message as terminal text.

### `PARITY-SHARED-TEXT-FORMATTER`

- Unified search and `pkg_upgrade_review` terminal/MCP text rendering use one
  shared formatter; other tools may share formatter code when their output is
  useful to both humans and agents.
- Shared formatters must accept surface-specific hints so MCP never emits
  CLI-only instructions like `--verbose` or `--lifecycle all`.
- Default MCP success output should be compact `text-v1`; programmatic
  parity tests must pass `format: "json"` explicitly.
- Empty `code_grep` decision guidance is shared between MCP text and CLI
  terminal stderr, with surface-native cursor syntax. Incomplete empty pages
  render truncation/pagination guidance instead of completed-result pivots.
  CLI stdout remains empty for grep-compatible zero-match behavior; JSON
  remains the shared structured envelope.

## Checklist for adding a new dual-surface tool

When a new tool lands with both MCP and CLI surfaces:

- [ ] Tool-specific defaults added to
  `packages/mcp/src/shared/code-navigation-defaults.ts` with a `TOOLNAME_` prefix.
- [ ] Request builder at `packages/mcp/src/shared/<tool>-request.ts`. Both surfaces
  import it.
- [ ] Error classifier reused (`mapCodeNavigationError` /
  `mapPackageIntelligenceError`). Add new `MappedErrorCode` variants
  only when a genuinely new error class exists; cover the new branch
  in the table test.
- [ ] Response builder at `packages/mcp/src/shared/<tool>-response.ts` emitting the
  shared success and error envelopes. JSON shape matches
  `PARITY-JSON-KEYS` rules.
- [ ] Parity test at `src/tools/<tool>-parity.test.ts` that cites the
  rule IDs it enforces (in a file header comment). Covers at minimum:
  successful query, zero-result, two error codes.
- [ ] For config-gated local-only pairs, add explicit service-param, JSON
  success, mapped-error, and invalid-input shape coverage without adding the
  tool to public or smoke inventories.
- [ ] MCP tool description mirrored across every shipped MCP surface
  before public release.
- [ ] Tool name added to `EXPECTED_MCP_TOOLS` in
  `packages/mcp/src/smoke-test.ts` so registration-only built smoke requires it.
- [ ] Corresponding top-level CLI command added to
  `EXPECTED_TOP_LEVEL_COMMANDS` in `scripts/cli-smoke.ts`, when applicable.

## Non-goals

- **Forcing identical default prose for tools without an intentionally shared
  formatter.** Unified search and `pkg_upgrade_review` deliberately share
  wording, hierarchy, and wrapping; other CLI terminal output and MCP text
  remain related products whose hints can be surface-native.
- **Shared MCP description copy.** Each tool's description targets a
  different decision the agent is making. Copy is not reusable.

## Related files

| File | Role |
|---|---|
| `packages/mcp/src/shared/code-navigation-defaults.ts` | Canonical cross-surface defaults and sentinels. |
| `packages/mcp/src/shared/code-navigation-error-map.ts` | `mapCodeNavigationError` classifier and code-navigation taxonomy. |
| `packages/mcp/src/shared/mapped-error.ts` | Transport-neutral `MappedError`, `MappedErrorCode`, and `MappedErrorDetails` contracts shared by all error mappers. |
| `packages/core-internal/src/shared/pkgseer-graphql.ts` | Low-level authenticated package/source POST helper shared by the service clients. |
| `packages/core-internal/src/shared/pkgseer-registry.ts` | Registry taxonomy (registry union type + lowercase↔uppercase converters). |
| `packages/mcp/src/shared/unified-search-request.ts` | Shared request builder for unified `search`; compiles structured query fields and applies defaulting. |
| `packages/mcp/src/shared/unified-search-response.ts` | Shared JSON envelope builders for unified `search` and follow-up `search_status`. |
| `packages/mcp/src/shared/package-summary-request.ts` | Shared request builder for `pkg_info`. |
| `packages/mcp/src/shared/package-summary-response.ts` | Lean JSON envelope builder and shared text/terminal formatter for `pkg_info`. |
| `packages/mcp/src/shared/package-vulnerabilities-request.ts` | Shared request builder for `pkg_vulns`. |
| `packages/mcp/src/shared/package-vulnerabilities-response.ts` | Lean JSON envelope builder and shared text/terminal formatter for `pkg_vulns`. |
| `packages/mcp/src/shared/package-dependencies-request.ts` | Shared request builder for `pkg_deps`. |
| `packages/mcp/src/shared/package-dependencies-response.ts` | Lean JSON envelope builder and shared text/terminal formatter for `pkg_deps`. |
| `packages/mcp/src/shared/package-changelog-request.ts` | Shared request builder for `pkg_changelog`. |
| `packages/mcp/src/shared/package-changelog-response.ts` | JSON envelope builder and shared text/terminal formatter for `pkg_changelog`. |
| `packages/mcp/src/shared/list-files-request.ts` | Shared request builder for `code_files`. |
| `packages/mcp/src/shared/list-files-response.ts` | JSON envelope builder for `code_files`. |
| `packages/mcp/src/shared/read-file-request.ts` | Shared request builder for `code_read`. |
| `packages/mcp/src/shared/read-file-response.ts` | JSON envelope builder for `code_read`. Normalises envelope key to `path` (not `filePath`) so `code_files` -> `code_read` chains without renames. |
| `packages/mcp/src/shared/grep-repo-request.ts` | Shared request builder for `code_grep`. Exports `GREP_REPO_PATTERN_NOTE` referenced by MCP description, MCP `pattern` describe, and CLI help. |
| `packages/mcp/src/shared/grep-repo-response.ts` | JSON envelope builder for `code_grep`. |
| `packages/mcp/src/shared/list-package-docs-request.ts` / `list-package-docs-response.ts` | Shared request and envelope for `docs_list`. |
| `packages/mcp/src/shared/read-package-doc-request.ts` / `read-package-doc-response.ts` | Shared request and envelope for `docs_read`. |
| `packages/mcp/src/shared/code-navigation-error-map.ts` | Owns the `INDEXING`, target/file-not-found, and exact-path authority codes shared across all code-nav tools. |
| `packages/mcp/src/shared/package-intelligence-error-map.ts` | `mapPackageIntelligenceError` classifier using the shared `MappedError` contract. |
| `packages/core-internal/src/services/promote-version-not-found.ts` | Shared helper that promotes generic backend errors with "no matching version" messages into typed `VERSION_NOT_FOUND`. |
| `packages/mcp/src/tools/code-navigation-shared.ts` | `codeTargetSchema` + `resolveCodeTarget` — the addressing primitive used by `code_files`, `code_read`, `code_grep`, and unified `search`. |
| `packages/mcp/src/tools/search.ts` | MCP tool definition for unified `search`. |
| `packages/mcp/src/tools/search-status.ts` | MCP tool definition for `search_status`. |
| `packages/mcp/src/tools/package-summary.ts` | MCP tool definition for `pkg_info`. |
| `packages/mcp/src/tools/package-vulnerabilities.ts` | MCP tool definition for `pkg_vulns`. |
| `packages/mcp/src/tools/package-dependencies.ts` | MCP tool definition for `pkg_deps`. |
| `packages/mcp/src/tools/package-changelog.ts` | MCP tool definition for `pkg_changelog`. |
| `packages/mcp/src/tools/list-files.ts` | MCP tool definition for `code_files`. |
| `packages/mcp/src/tools/read-file.ts` | MCP tool definition for `code_read`. |
| `packages/mcp/src/tools/grep-repo.ts` | MCP tool definition for `code_grep`. |
| `packages/mcp/src/tools/list-package-docs.ts` / `read-package-doc.ts` | MCP tool definitions for the docs surface. |
| `src/commands/search.ts` | Top-level CLI commands for unified `search` and `search-status`. |
| `src/commands/pkg/info.ts` / `vulns.ts` / `deps.ts` / `changelog.ts` | CLI commands for the `pkg` group. |
| `src/commands/code/files.ts` / `read.ts` / `grep.ts` | CLI commands for the `code` group. |
| `src/commands/docs/list.ts` / `read.ts` | CLI commands for the `docs` group. |
| `src/tools/*-parity.test.ts` | Parity tests; each cites the rule IDs it enforces. |

## Per-tool notes

### `pkg_info`

- **Permissive MCP schema + in-handler validation.**
  `buildPackageSummaryParams` is the single validator used by both
  surfaces; raw Zod errors never surface in the envelope.
- **`@version` rejection.** CLI-only. The MCP tool has no `version`
  input. The CLI's `pkg info` throws `InvalidPackageSpecError` on
  any non-null parsed version — never silently swaps to latest.
- **Shared package-summary envelope and formatter.** CLI `--json` and MCP
  `format: "json"` use the same lean envelope, including additive
  `versionCount`, `downloads.refreshedAt`, and `advisoryHistory.total` fields.
  The shared formatter also owns the latest-versus-history text semantics:
  `vulnerabilities.total` is latest-version affectedness and
  `advisoryHistory.total` is package-wide non-withdrawn, deduplicated history.
  History remains renderable when the nullable latest count is unavailable.
- **Evidence-only vulnerability field.** Both compact text surfaces use the same
  `Latest:` and `History:` labels and do not append an inline action. CLI help
  routes full-history inspection to
  `githits pkg vulns <registry>:<name> --scope all`; the MCP descriptor routes it
  to `pkg_vulns` with `advisory_scope: "all"`. Package-summary text otherwise
  differs only through ANSI and width inputs: color-enabled CLI output uses
  non-bold cyan for repository/homepage URL substrings, while no-color CLI and
  MCP retain identical content and hierarchy.
- **Compact versus detailed fetching.** Default text requests
  `includeVerboseFields: false`; verbose text and JSON request `true` on both
  surfaces. `allVulnerabilityCount` is selected for every package summary,
  while `versionCount` and `downloadsRefreshedAt` are selected only for the
  detailed modes.

### `pkg_vulns`

- **Permissive MCP schema + in-handler validation.**
  `buildPackageVulnerabilitiesParams` is the single validator.
- **Filter-aware summary.** `minSeverity` + `includeWithdrawn` go
  straight to the service; the returned `vulnerabilityCount`
  reflects the filtered set. No client-side filtering.
- **Partitioning bySeverity buckets.** `summary.bySeverity` carries
  a `malware` key for `isMalicious === true` advisories; severity
  bands for non-malicious advisories with a positive CVSS score;
  and `unrated` for non-malicious advisories with no score. Every
  returned advisory lands in exactly one bucket — `MALWARE + crit
  + high + medium + low + unrated = advisories.length`. Malware
  advisories sort first regardless of severity score; `unrated`
  advisories sort last within the active bucket.
- **Typed `VERSION_NOT_FOUND`.**
  `PackageIntelligenceVersionNotFoundError` carries structured
  fields (`packageName`, `requestedVersion`, `availableVersions`).
  The classifier emits structured `details` in the error envelope.
- **Client-side `v`-prefix rejection.** Tag-style inputs like
  `v4.18.0` are rejected as `INVALID_ARGUMENT` with an actionable
  message before the service call.

### `pkg_deps`

- **Data-first envelope.** `runtime`, `groups`, and `transitive` are
  three independent blocks emitted based on what the backend
  returned and what the caller asked for, not on additional caller
  flags. `include_issues: true` adds a separate top-level `issues`
  block; issue analysis alone does not expose `transitive` unless
  `max_depth` or `include_importers` independently requests that output.
- **Issue-analysis request.** CLI `--issues` and MCP
  `include_issues: true` use the shared request builder and service
  parameter. The option is uncoupled and opt-in: omission/false preserve
  existing selections and cost. A true value selects the lazy
  `dependencyIssues` subtree and the companion graph; omitted depth means
  full graph analysis, while `--depth N` / `max_depth: N` bounds both the
  issue scope and graph.
- **No `include_groups` input.** The data-first envelope emits the
  `groups` block unconditionally when the backend returned
  `dependencyGroups`, so an `include_groups: true` input would be a
  silently ignored no-op.
- **Dependency list naming.** Every list of dependencies in the
  envelope uses the `items` key: `runtime.items`, `groups.items`
  (array of groups), each group's nested `items` (array of member
  deps).
- **Lifecycle filter echo.** `filter.lifecycles` is the
  canonicalised, deduplicated, display-order-sorted array the
  backend actually received. Emitted only when the caller supplied
  a non-empty input.
- **Null vs empty matters.** `groups` is omitted entirely when the
  backend returned `dependencyGroups: null`; emitted with
  `items: []` when the backend returned a non-null
  `dependencyGroups` with zero groups (filter matched nothing).
- **Terminal-only dedup.** Crates feature groups can contain
  duplicate `{name, constraint}` tuples (target-cfg branching). The
  terminal formatter collapses them; the JSON envelope preserves
  every duplicate the backend emitted.
- **Preprocessed transitive.** `transitive.packages[]` carries
  `{name, version, importers[]}` records; `conflicts[]` is typed
  `{name, requiredVersions, requirements}` when decodable;
  `circularDependencies[]` is typed `{cycle: string[]}` when decodable.
  Each conflict requirement preserves one backend edge in its original
  multiplicity/order as `{constraint, dependencyType, importer, target}`.
  Importer and target identities carry registry/name/version; synthetic-root
  edges use the inspected package identity with `root: true`. Graph indices
  never escape the envelope and the raw DAG is deliberately dropped.
- **Dependency issue envelope.** `issues` contains `total`, `scope`
  (`{mode: "full"}` or `{mode: "depth_limited", maxDepth}`), and
  `deprecated`, `outdated`, `duplicates`, and `conflicts` records, each
  shaped as `{count, items}`. Deprecated items preserve registry/name,
  versions, and per-version reasons; outdated items preserve registry/name,
  versions with severity, optional latest version and repository URL; duplicate
  items preserve optional registry/name and all versions; conflict items
  preserve optional registry/name, resolved versions, required versions, and
  complete requirements. Zero analysis emits `total: 0` and all four empty
  category records. JSON preserves backend order/multiplicity; text-only
  sorting, grouping, and bounds do not alter parity JSON.
- **Issue text and cost boundary.** Both surfaces use the shared formatter.
  Compact output reports total/scope and all four counts, then caps examples
  at three per category and conflict constraint/importer groups at three each.
  CLI `--verbose` renders all selected issue rows and requirements; MCP keeps
  text compact and supplies `Pass format: "json" for complete issue details.`
  when bounded evidence is omitted. The service query selects
  `dependencyIssues` through `@include(if: $includeDependencyIssues)` with
  default false, so normal/false calls do not compute or fetch that subtree;
  issue mode fetches the internal companion graph but never exposes it.

### `pkg_changelog`

- **Dual addressing — the only pkg-intel tool with it.** `registry`
  + `package_name` XOR `repo_url` on both surfaces, because
  `packageChangelog` is intrinsically repo-level.
- **`<spec>@<version>` rejected.** Other `pkg` commands give
  `@version` a meaning, but changelog has no single-version query
  — remapping to `to_version` would be a client-invented semantic
  shift. Both surfaces redirect callers to `--to` / `to_version`.
- **Mode mutex enforced client-side.** `--from` / `from_version` +
  `--limit` / `limit` together → `INVALID_ARGUMENT`.
- **`filter.*` echo tracks explicit fields only.** Backend-default
  values never round-trip as caller intent.
- **`entries: { count, items }` shape.** Mirrors `runtime: {count,
  items}` from `pkg_deps`.
- **Missing source with entries succeeds.** Package-version entries can
  arrive with null or empty `source` when no concrete changelog text
  exists for that version. Both surfaces omit `source` in the success
  envelope and keep the version entries. Missing source plus no entries
  is promoted to `PackageIntelligenceChangelogSourceNotFoundError` with
  a message naming the sources tried (GitHub Releases, CHANGELOG.md,
  HexDocs).
- **`--verbose` / `--no-body` / `--json` interaction.** Default
  terminal output truncates each entry's body at 10 lines.
  `--verbose` lifts the cap (terminal-only). `--no-body` mirrors
  MCP's `omit_bodies: true` and affects both terminal and
  `--json`. `--no-body` + `--verbose` is rejected.

### `pkg_upgrade_review`

`pkg_upgrade_review` and `githits pkg upgrade-review` use the same pure
human-readable formatter. The CLI supplies `process.stdout.columns` and ANSI
enablement; MCP supplies no ANSI and uses the formatter's 80-column default.
With the same width and ANSI disabled, the text is equivalent apart from the
CLI's existing trailing newline convention. `text-v1` is an evolving
presentation contract, so parity covers hierarchy and wording invariants rather
than byte stability: the outcome headline, package coordinate, evidence-group
headings, stable locators, bounded samples, and explicit unknown/zero states.

The default order is identity, `Security` with direct and optional transitive
summary rows before non-empty advisory groups, target `Deprecation`, `Changes`,
`Compatibility`, `Dependencies`, returned
`Dependency issues`, and `Unknown evidence`. A batch adds one `Across packages:`
summary. The formatter keeps JSON unchanged and lossless for machine callers;
CLI `--json` and MCP `format: "json"` are the structured parity boundary. ANSI
is semantic styling only: bold outcome/headings, bold cyan identity, and yellow
compact attention summaries, labels, and matched signal terms. Heuristic
section labels remain plain; only the matched keyword and excerpt marker are
yellow. Evidence detail and locators remain plain. Words remain sufficient
without color, authored punctuation is ASCII, and backend Unicode is preserved.

### `code_files` / `code_read` / `code_grep` (file-exploration bundle)

All three reuse `codeTargetSchema` + `resolveCodeTarget` from
`packages/mcp/src/tools/code-navigation-shared.ts`. The indexing lifecycle is
shared (see `tools.md` "Indexing lifecycle" section). Parity tests
cover dual addressing, default + explicit filter echoes, INDEXING
error envelope, NOT_FOUND envelope, and INVALID_ARGUMENT with full
envelope shape.

- **`code_files`**: `filter.path_prefix` / `filter.limit` echo only
  when explicit. Default `limit: 200` never round-trips. Backend
  returns `total` capped at returned count when `hasMore: true`;
  terminal formatter renders `N+`.
- **`code_read`**: envelope uses `path` (not `filePath`) to match
  `code_files.files[].path`. Binary files: `isBinary: true` +
  `content` omitted (not `null`). INDEXING details may carry
  `indexingRef`, `indexingEstimate`, and any backend-provided
  indexed refs/versions; callers must branch on whichever retry
  candidates are present instead of assuming every tool has all fields.
  Missing exact paths preserve `details.filePath` across surfaces while
  `details.action` renders the matching MCP or CLI recovery syntax.
- **`code_grep`**: `GREP_REPO_PATTERN_NOTE` (exported from
  `grep-repo-request.ts`) keeps the literal-vs-regex disclosure
  identical across MCP description, MCP `pattern` describe, and
  CLI help. The shared request builder compiles `path`,
  `path_prefix`, and `globs` into backend `pathSelectors`, defaults
  grep to whole-target literal ASCII case-insensitive matching;
  whole-target regexes must include at least one literal substring.
  `symbol_fields` / `--symbol-field` passes backend symbol
  hydration through to `symbolFields`. Supported fields are
  `symbol_ref`, `name`, `qualified_path`, `kind`, `category`, `arity`,
  `is_public`, `file_path`, `start_line`, `end_line`, `content_hash`, and
  `parent_path`; the response envelope
  carries `matches[].symbol` when the backend hydrates it. Empty text uses
  shared scan/scope/served-target context and branches recovery on whether
  `filesInScope` is zero. Completed scans reject an unchanged repeat;
  incomplete empty pages preserve truncation/pagination continuation instead.
  Exact-path `FILE_NOT_FOUND`, `FILE_PATH_EXCLUDED`, and
  `SOURCE_FILE_INVENTORY_UNKNOWN` errors follow the same shared-data,
  surface-native-action contract as `code_read`.
