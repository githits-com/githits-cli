# Code diff graduation audit

Audit date: 2026-10-02. Target: production presets, checkout
`896a76555145449cdaeacba7d07918ba96137e60`. The baseline results below were
produced before promotion; the GA implementation follows in the same product
PR. They are historical evidence, not results for default-enabled registration.

## Decision and instructions

The existing exact-tree architecture is suitable for graduation. CLI and MCP
already share request normalization, service queries, projection, and error
mapping; their intentionally different text formats need no redesign.
At the baseline, graduation still required default CLI registration, public MCP composition,
stable routing guidance, smoke inventory updates, and release delivery.

The baseline stable guide said package targets scope to package subpaths. That
is correct for indexed navigation and wrong for raw diffs. The diff descriptor
and local appendix explain the repository-wide exception. Promotion must add
that exception to the stable guide and its exact public skill copy together.
The stable routing table also needs an explicit raw-source-comparison route;
`pkg_upgrade_review` remains the route for upgrade assessment.

The descriptor's first sentence already fits the discovery length contract:
“Compare source across exact package versions or public repository refs.”
Preserve its distinct job, separate endpoints, repository scope, bounded
content, preview limits, and compatibility caveat when removing Experimental.
Descriptor-only discovery must be evaluated independently of explicit intent.

## Reproducible direct matrix

Run from the repository root with existing production authentication:

```sh
bun run scripts/code-diff-audit.ts .agent-eval/code-diff-ga/live
```

The script uses real source CLI subprocesses and a real local stdio MCP server,
production endpoint presets and isolated CLI/MCP config. The baseline runs
used experimental opt-in; the current script explicitly sets `tools = false`
for both surfaces and passes no MCP experimental override. It does not modify the user's config. It writes
public response artifacts and a per-cell result matrix to the specified local
directory; it does not write credentials or request headers. The verified
local authentication source was macOS Keychain. This is a local Bun audit,
not a CI live-data gate or a cross-platform runtime claim.

| Coverage | Cases and assertions |
| --- | --- |
| All four views, both surfaces, text and JSON | Express npm versions, GitHub tags and SHAs, reverse and identical ranges, a matching glob and an empty glob, explicit file truncation, React repository-wide and package-path-filtered results |
| All twelve registry syntaxes | npm, PyPI, crates, RubyGems, Go, Hex, NuGet, Maven, Packagist, Swift, Zig, vcpkg; additional registries use bounded inventory and CLI/MCP JSON equality |
| Repository providers and addressing | GitHub, Codeberg, GitLab, compact targets, explicit `--repo-url`, tag/SHA identities; HEAD is validated independently per call because it is mutable |
| Omitted-view defaults | CLI patch output and MCP name-status inventory, each checked through JSON and text |
| Content and bounds | Exact commit identity, inventory completeness, mode-dependent fields, path filters, file truncation warnings, non-applicable patch suppression, partial patch budgets, JSON parity |
| Failures | Unpublished version, missing ref, embedded version/ref, empty endpoint, out-of-range file bounds, traversal and unsupported brace globs, unsupported repository metadata, unavailable historical package data, unregistered package |

Initial matrix: **99 passed, zero failed**, before the additional registry and
provider cases were incorporated. Expanded matrix: **121 passed, zero failed**;
the final strengthened matrix passed **123 cells, zero failed**, including
omitted-view defaults, known commit identities, exact name/name-status text
paths, stat paths, and preservation of applicable patch content. Final artifacts
are in `.agent-eval/code-diff-ga/final-live/`; earlier runs remain retained.
Upper numeric limits, unusual path bytes, binary and
mode-only changes, content filtering/failure, malformed responses, refresh,
and GraphQL over-fetch controls also have deterministic test coverage. They
are not all manufactured on live repositories.

Independent patch check: read all 271 lines of `lib/utils.js` at both exact
Express SHAs using GitHits `read --json`; verify the served SHAs; apply the
returned scoped patch with `git apply --check` and `git apply` in a disposable
directory. The applied file exactly matched the independently read target.
Evidence: `.agent-eval/code-diff-ga/patch-oracle.json`, the two `read-*.json`
files, and `live/glob-patch-cli.json`. This verifies one real text patch,
not every patch, binary file, or metadata transition.

## Live fixture limitations and recovery

- Maven `org.apache.commons:commons-lang3` resolves package metadata to
  `https://gitbox.apache.org/repos/asf/commons-lang`, outside the supported
  repository providers. Diff returns non-retryable BACKEND_ERROR with the
  explicit unsupported-repository message. A separate verified Guava Maven
  comparison succeeds. No inferred repository substitution was added.
- Packagist `symfony/http-foundation` `6.4.0..6.4.1` returns VERSION_NOT_FOUND
  on the ending version, with published-version and proven-ref alternatives.
  A separate `8.1.7..8.1.8` comparison selected from those alternatives
  succeeds. This is not evidence that the historical version was never
  published upstream; it establishes the production service's limitation.
- The original Zig matrix fixture `gh/ziglibs/known-folders` reports one
  version `0.7.0`; its self-comparison succeeds. Follow-up verification found
  that `gh/ziglang/zig` was an unsuitable package fixture: the compiler's
  [0.14.0 manifest](https://github.com/ziglang/zig/blob/0.14.0/build.zig.zon)
  explicitly says it is not intended to be consumed as a package. Its
  NOT_FOUND response is not evidence of broken indexing on access.
  A valid library, `zig:gh/hejsil/zig-clap`, succeeds for
  `0.11.0..0.12.0` with 12 changed files, exact distinct tag SHAs, and
  identical bounded CLI/MCP name-status JSON. Both upstream manifests
  declare the requested package versions. Evidence is retained in
  `.agent-eval/code-diff-ga/zig-clap-check.json` and
  `zig-clap-mcp-check.json`. This additional comparison closes changed-version
  Zig coverage; it is separate from the original 123-cell matrix. It does
  not verify indexing on access for a previously unseen valid package.
  Valid packages are expected to index on access; absence from existing
  package data must not by itself be accepted as a product limitation.
- React `19.0.0..19.1.0` reports 2,530 repository-wide changed files; the first
  three ranked files are outside `packages/react/`. A `packages/react/**`
  filter reports 45 changed files. This directly exercises the scope caveat.

These limitations are explicit negative cases, not disguised successful
comparisons. No backend modifications or new fallback machinery were made.

## Agent workloads and observed use

There was one neutral diff workload. Four were added under
`eval/agentic/workloads/` and classified experimental in `suites.json`:

| Workload suffix | Behavioral question |
| --- | --- |
| `experimental-code-diff` | Exact Express changed paths and source content; separate source evidence from upgrade safety |
| `-repository` | Repository tags, full commit identities, direction, and an identical-ref control |
| `-monorepo` | Bounded repository-wide overview followed by a package-path filter, with explicit scope and completeness |
| `-recovery` | Unavailable package version, evidence-backed alternatives, and a separate successful range without silently replacing the request |
| `-bounded` | File-count, aggregate patch-byte, and displayed preview limits; full returned content versus omitted content |

Executed 14 cells with the existing `bun run agent:e2e` harness:

- Claude and Codex: the original workload with `--guidance-profile descriptors`
  and neutral intent (two discovery cells).
- Both agents: all five workloads with descriptors and
  `--intent-profile githits` (ten intent cells).
- Both agents: monorepo workload with `--guidance-profile full` and neutral
  intent (two full-guidance cells).
- All cells used `--surface mcp --server local --experimental-tools`,
  a 300-second per-workload timeout, and production endpoints. Intent batches
  used `--concurrency 2`. Model selection was the harness default: Claude
  resolved to `claude-sonnet-5-5`; Codex requested `gpt-6-luna` at high effort.
  Authentication was injected through existing secure local stores; no token
  values were written into commands or artifacts.

All 14 cells produced valid success reports and no isolation-violation files.
Actual calls were inspected in `tool-calls.json`, answers and confidence in
`final.json`, derived usage in `metrics.json`, and returned evidence in the
redacted traces. Both agents used `code_diff` in all ten intent cells and both
full cells. Claude used it in neutral discovery; Codex used npm/GitHub evidence
and made zero GitHits calls. That Codex cell is **not** tool acceptance evidence.

Observed answers retained repository scope, truncation, missing-endpoint
distinctions, and compatibility caveats. The bounded Codex run reported that
no patch fit its selected 1024-byte requests; Claude explicitly raised a
separate focused budget and obtained a full patch. These are trace observations,
not graded usefulness, a discovery rate, or a performance comparison. Claude's
adapter does not derive logical-call or token/cost metrics; do not compare its
raw started events with Codex's logical counts.

Raw evidence is local and ignored under
`.agent-eval/code-diff-ga/{claude,codex}-{discovery,intent,full}`. Workload prompts
and the direct matrix remain committed for reproducibility. CLI-only agent
and published/hosted evaluations belong to release preparation and delivery.
The baseline experimental eval override supported only local MCP.

## Deterministic and runtime validation

| Exact command | Result |
| --- | --- |
| `bun test src/commands/code/diff.test.ts src/tools/code-diff-parity.test.ts packages/mcp/src/tools/code-diff.test.ts packages/mcp/src/shared/code-diff-request.test.ts packages/mcp/src/shared/code-diff-response.test.ts packages/mcp/src/shared/code-diff-text.test.ts packages/core-internal/src/services/code-navigation-service.test.ts` | 211 passed, zero failed |
| `bun test` | 5,325 passed, zero failed across 230 files |
| `bun test scripts/agent-eval.test.ts scripts/agent-eval-suite.test.ts` | 194 passed, zero failed |
| `bun run typecheck` | Pass |
| `bun run build` | Pass |
| `bun run smoke:cli --mode unauthenticated` | Pass |
| `bun run smoke:mcp --mode registration` | Pass |
| `bun run smoke:cli:built` | Pass under Node |
| `bun run smoke:mcp:built` | Pass under Node |
| `bun run scripts/code-diff-audit.ts .agent-eval/code-diff-ga/final-live` | 123 passed, zero failed |
| `bunx --no-install biome lint scripts/code-diff-audit.ts` | Pass |

The first full unit run exposed two audit-edit integration omissions: manifest
count expectations and explicit workload filenames in README. Both were fixed;
the complete suite then passed. The prior README also understated the existing
stable inventory as 25 rather than the manifest's 31; this was corrected.
The config policy doc's stale 15-tool count was removed; the current public
descriptor inventory was 12 at the baseline; GA promotion changes it to 13.
Its exact inventory belongs to catalog tests.
Authenticated validation was deliberately the diff-only matrix. Unrelated
live Research and package-tool suites were not run. No Windows runtime,
published GA package, hosted GA server, or graded answer-quality claim is made.

No optimization was attempted, so no performance benchmark is required or
claimed. No production refactor is needed: reuse the shared diff components
and move registration/guidance into the stable surface.

Internal review found two audit-proof gaps: parity alone could accept a shared
wrong commit, and explicit views left live defaults untested. Both were fixed
and the complete revised delta was re-reviewed clean; the final live matrix
then passed. Claude round 1 found only minor plan/doc corrections: specify the
audit script's stable-config migration and lifecycle, record the final matrix,
and classify the future public service-contract release impact in Phase 1.
All were accepted and applied; the doc-only round counts as clean.

## Default-enabled implementation validation

The GA implementation makes CLI and public MCP diff available by default,
renames all five workloads to stable `code-diff*` names, and adds the base
comparison to smoke. The manifest now has 41 workloads: 36 stable, one
stateful, and four experimental; smoke selects seven. Guidance and its public
MCP skill copy preserve exact parity and explain repository-wide raw scope.

Implementation checks passed: 5,327 unit tests across 230 files; 353 focused
MCP/catalog/guide/smoke/parity tests across 12 files; typecheck; build;
plugin generation/check; public-package validation including outside-root
typed provider and real packed SDK diff invocation; source unauthenticated CLI
and registration MCP smoke; and both built smoke modes under Node. The 353
focused tests made 2,082 assertions. Local logs are retained under
`.agent-eval/code-diff-ga/stable-*.log`.

The default-enabled production matrix passed **125 cells, zero failures** at
`27019e28f0ea45e2d016e94ffd5948d6e89e35f0`. Both CLI and local stdio MCP
used an isolated `experimental.tools = false` config, with no MCP override.
This includes the distinct-version valid Zig library comparison and its
identical-version control. Exact command:

```sh
bun run scripts/code-diff-audit.ts .agent-eval/code-diff-ga/resumed-live
```

All **14 default-enabled agent cells** produced successful final reports,
with zero isolation violations. Both agents used `code_diff` in all ten
descriptor-intent cells and both full-guidance monorepo cells. Claude also
used it in neutral discovery. Codex neutral discovery used public npm/GitHub
evidence and made zero GitHits calls; that cell is not tool acceptance
evidence. Actual calls, answers/confidence, derived metrics and isolation
artifacts were inspected. Answers retained repository scope, unavailable
endpoint distinctions, incomplete patch evidence and compatibility caveats.
Claude's bounded run raised a separate focused budget to obtain a complete
returned patch; Codex retained the original 1024-byte cap and correctly
reported that the source service omitted all requested patches. Codex's
monorepo intent run explicitly distinguished complete backend coverage from
client display truncation. These are trace observations, not graded answer
quality or a discovery/performance rate. Claude logical-call/token/cost
metrics remain unavailable; Codex metrics must not be compared with Claude
raw event counts.

The cells use `--surface mcp --server local`, with no experimental flag and
an isolated false config. For each of Claude and Codex, reproduce the three
profiles using existing secure local agent authentication:

```sh
bun run agent:e2e --agent <claude|codex> --surface mcp --server local --guidance-profile descriptors --intent-profile githits --concurrency 2 --out <intent-output> --workload eval/agentic/workloads/code-diff.md --workload eval/agentic/workloads/code-diff-repository.md --workload eval/agentic/workloads/code-diff-monorepo.md --workload eval/agentic/workloads/code-diff-recovery.md --workload eval/agentic/workloads/code-diff-bounded.md
bun run agent:e2e --agent <claude|codex> --surface mcp --server local --guidance-profile descriptors --intent-profile neutral --concurrency 2 --out <discovery-output> --workload eval/agentic/workloads/code-diff.md
bun run agent:e2e --agent <claude|codex> --surface mcp --server local --guidance-profile full --intent-profile neutral --concurrency 2 --out <full-output> --workload eval/agentic/workloads/code-diff-monorepo.md
```

Artifacts remain local in `.agent-eval/code-diff-ga/resumed-evals/`, including
`acceptance-inspection.json`; every metrics record reports
`experimentalTools: false`. Earlier Keychain-blocked runs and diagnostic
evidence remain preserved. After the user returned, local access succeeded;
no credential, production data, timeout, or retry mechanism was changed.

Implementation review completed cleanly after minor documentation/test-helper
corrections, with a fresh-context final check. The affected Resolve parity
suite passed 31 tests, and unauthenticated CLI smoke passed again.
[CI at the validated commit](https://github.com/githits-com/githits-cli/actions/runs/37012649846)
passed build/checks, Linux/Windows unit suites, MCP package validation, and
compatibility checks for Bun and Node 20/22/24/26. Publication was skipped.
Published and hosted GA delivery remain separate release/adoption steps.
