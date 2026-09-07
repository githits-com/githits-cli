# Release 0.13.0 validation

Validated September 7, 2026, from source base
`1cf802aa56e9968ff986a517252e1a181faed231`. Release preparation changes only
versions, generated manifests, changelog consolidation, and CLI documentation
read-target guidance. Runtime behavior was merged before this release branch.

## Release audit

Both public artifacts move from 0.12.1 to 0.13.0. The six pending fragments
were reconciled against both complete tag ranges:

- `git log v0.12.1..HEAD`: positional upgrade ranges (#355), semantic search
  evidence and output format guidance (#359), and documentation URL targets (#357).
- `git log mcp-v0.12.1..HEAD`: the same shared changes plus canonical Go version
  handling (#354); positional CLI ranges do not affect the MCP package.

The root tag `v0.12.1` resolves to `08ea9c084cc398db991f165d51e0b40653b4625d`;
`mcp-v0.12.1` resolves to `3debd53e6061c9d401d87a638d756f6efec84b1d`.
Both match the remote tags. The Go fragment was already present at the root
release tag. The new root section explicitly records it as already shipped in
CLI 0.12.1, closing the missing release note without implying a new CLI fix.
The MCP section records its first MCP release. Historical changelog text is unchanged. All six fragments are consumed atomically by
this coordinated release, accounting for that already-shipped CLI fix.

An initial `git fetch origin --tags` rejected a conflicting historical local
`v0.1.0`. It was not replaced. `git fetch origin main --no-tags` and direct
`git ls-remote --tags` checks verified the relevant base and release tags.

Canonical package and registry versions were updated and plugin assets
regenerated. The current generator includes a version in portable `plugin.json`,
contrary to the older versionless wording in agent guidance. That wording is
corrected in `AGENTS.md` and the internal release skill; the generated manifest
follows the verified generator and existing published layout.

Public CLI code/docs guidance now uses emitted `docsReadTarget` values and
separates them from provenance `sourceUrl`. The MCP guide already had this
contract. Package range guidance was already aligned; onboarding is unaffected.

## Deterministic and live checks

| Command | Result |
| --- | --- |
| `bun test` | 4,047 passed, 0 failed; 13,941 assertions across 195 files |
| `bun run plugins:generate` / `bun run plugins:check` | Generated assets current |
| `bun run typecheck` | Passed |
| `bun run format:check` / `bun run lint` | Passed; 459 files checked |
| `bun run build` / `bun run --cwd packages/mcp build` | Passed |
| `bun run validate:packages:mcp-publish` | Passed, including external consumer and npm publish dry-run checks |
| `bun run smoke:cli` | Passed; stable and experimental authenticated cohorts, 106 steps |
| `bun run smoke:mcp` | Passed; stable and experimental cohorts, 57 steps |
| `bun run smoke:cli:built` | Passed; 23 unauthenticated Node artifact steps |
| `bun run smoke:mcp:built` | Passed; 8 stable/experimental registration steps |

The initial built CLI attempt failed while the public-package validator was
rebuilding `dist`; its diagnostic output was not retained, so that overlap is
not a proven diagnosis. Both built suites passed after the validator completed.
Run artifact-consuming checks after the validator because it rebuilds both
packages. No product fix was inferred from the failed attempt.

Live calls used the repository defaults: `pkgseer.dev`, `api.githits.com`, and
`mcp.githits.com`. Local MCP ran the candidate's `dist/cli.js` under Node.
Code search responses contained focused source and semantic context, verifying
the required backend schema on the default endpoint. Hosted MCP itself was
not upgraded or used as the candidate tool implementation. A direct unauthenticated
HTTP check returned 200 for hosted OAuth protected-resource metadata (matching
resource and nonempty authorization servers) and 401 with a `resource_metadata`
challenge for an MCP initialize request.

## Search consistency matrix

Each final scenario compares three built CLI JSON searches with one local MCP
JSON search, including ordered results, locators, structural evidence,
completion, partial-results status, and pagination fields. It also validates
CLI text structure and checks both text surfaces retain each JSON hit locator.
When another page exists, CLI/MCP second pages must agree and not repeat a
first-page locator. The first hit's read target is exercised; focused source
lines must equal the retrieved source, and docs URL/ID reads must return the
same page and content matching the search excerpt.

| Scenario | Target | Query / filter | Hits | Result |
| --- | --- | --- | ---: | --- |
| Package code | `npm:express@5.2.1` | `handle request response`, code | 5 | Passed |
| Package symbol | `npm:express@5.2.1` | `sendfile`, symbol | 1 | Passed |
| Re-export absent from symbol index | `npm:express@5.2.1` | `Router`, symbol | 0 | Passed |
| Package docs | `npm:express@5.2.1` | `middleware`, docs | 5 | Passed |
| Repository code | `github:expressjs/express#v5.2.1` | `handle request response`, code | 5 | Passed |
| TypeScript repository | `github:anomalyco/opencode#v1.18.15` | `compaction`, code | 5 | Passed |
| Site docs | `site:expressjs.com` | `middleware`, docs | 5 | Passed |
| Multiple targets | Express package and repository above | `handle request response`, code | 5 | Passed |
| Path filter | Express package | `request`, code, `lib/response.js` | 1 | Passed |
| Language filter | Express package | `request`, code, `javascript` | 5 | Passed |
| Kind filter | Express package | `sendfile`, symbol, `function` | 1 | Passed |
| Quoted query | Express package | `"Request aborted"`, code | 5 | Passed |
| Empty path scope | Express package | `request`, code, `__release_consistency_nonexistent__/` | 0 | Passed |

The initial exploratory run contained incorrect test assumptions, retained in
its artifacts: a re-export need not have a symbol hit; an arbitrary nonsense
query need not return zero in discovery search; docs search may emit a numeric
ID while reads return the same ID with a title suffix; symbol locators may
omit `endLine`. Corrected checks use a declared function, an empty path scope,
URL/ID content equivalence, and the emitted optional read range. These were
validation-script corrections, not changes to production behavior.

All 13 final scenarios passed. Seven passed in the original run; six corrected
or additional scenarios passed in the follow-up. The two runs made 140 calls
including exploratory failures. Original artifacts were preserved rather than
overwritten. This establishes consistency for the sampled targets and run
window, not universal relevance, ranking stability across backend updates, or
coverage of every registry. Live queries completed synchronously; asynchronous
search-status behavior is covered by the existing unit and smoke suites.

Local reproduction artifacts are retained in the ignored
`.agent-eval/release-0.13.0/` directory: `search-consistency-initial.ts`,
`search-consistency.ts`, JSON/text responses, first-page result hashes,
`summary.json`, and `followup/summary.json`. The commands were
`bun .agent-eval/release-0.13.0/search-consistency.ts` before and after the
recorded script corrections. Raw validation logs are under
`/tmp/githits-013-*.log`. These local artifacts are not distributed in npm.

## Agent checks

The existing `agent:e2e` harness ran Codex CLI 0.153.4 with `gpt-5.6-luna`,
low reasoning effort, local candidate tools, and a 300-second workload limit.
The dedicated eval home was `/Users/jpl/.codex-eval`. Existing authentication
was supplied only through the harness-supported child environment; credentials
were not printed or copied into artifacts.

The descriptor-only intent run of `search-source-ergonomics.md` completed eight
successful MCP calls: quick_start, docs and code searches, a URL docs_read,
and four code_read calls. Search source routing was correct; both searches
used JSON and follow-up reads used text. The final answer used the retrieved
Zod documentation and Router source. No isolation violation file was emitted.
This is successful navigation evidence, not a comparative quality grade.

The neutral CLI skills run of `docs-search-followup.md` initially failed both
GitHits calls because the isolated home could not access the system keychain.
The agent still returned a high-confidence answer, so harness success was
excluded as evidence. With supported in-memory authentication, a second
neutral run chose web search and made no GitHits calls; it likewise does not
validate the changed CLI guidance.

The controlled CLI workload then explicitly requested GitHits CLI documentation
search followed by reading a returned target. It completed both calls, reading
`https://expressjs.com/llms/full.txt` at lines 1427-1437 from the search result.
The final answer cited that evidence, and no isolation violations were emitted.
This verifies the read-target handoff when the CLI surface is selected; it does
not establish autonomous tool-selection reliability.

Exact authenticated run commands (the wrappers inject the existing token into
the child environment and redact it from persisted output):

```sh
bun .agent-eval/release-0.13.0/run-authenticated-evals.ts
bun .agent-eval/release-0.13.0/run-controlled-eval.ts
```

The wrappers invoke `bun run agent:e2e --agent codex --model gpt-5.6-luna
--reasoning-effort low --server local --timeout 300`, with these run-specific
arguments and separate `--out .agent-eval/release-0.13.0/<run>` directories:

- `skills-docs-auth`: `--surface skills --workload eval/agentic/workloads/docs-search-followup.md`
- `mcp-search-auth`: `--surface mcp --guidance-profile descriptors --intent-profile githits --workload eval/agentic/workloads/search-source-ergonomics.md`
- `skills-docs-controlled`: `--surface skills --workload .agent-eval/release-0.13.0/docs-url-controlled.md`

The controlled workload is recorded in its local artifact:

> Use the GitHits CLI and its githits-code skill to find Express documentation
> explaining how route handlers are defined. Search package documentation, read
> a returned documentation target, and cite the evidence in your answer. This
> task specifically checks the CLI documentation search-to-read handoff.

## Review closure

One Claude Opus review examined commit `097528e`, the complete release delta
against `origin/main`. No reviewer subagents or additional review rounds ran.
Findings were adjudicated against the actual tags and release rules:

- Accepted the missing CLI Go release note. The root cause was treating
  already-shipped behavior as grounds to discard its still-unrecorded note.
  Both package sections, all consumed fragments, their tag ranges, and the PR
  description were checked. The new CLI section labels it as already shipped
  in 0.12.1; MCP lists the new fix. Rejected the suggested edit to historical
  0.12.1 notes: an omitted detail does not satisfy the repository's explicit
  historical-edit exception. This decision is dated September 7, 2026.
- Accepted the CLI summary omission. Its intro now calls out the `->` to `..`
  migration, consistent with its existing detailed bullet. Both artifact
  summaries and their compatibility notes were checked.
- The reviewer correctly observed pending guidance/report edits outside the
  reviewed commit. Those were ongoing coordinator work, not a release defect;
  they are included in the final closure commit. The versionless-wording fix
  was checked in both canonical guidance files and against generated assets.

Codex verified the small documentation closure inline. Generated-asset checks,
format checking, a fresh root build, and 24 focused skill-packaging/release
boundary tests (229 assertions) passed. Historical changelog sections remain
byte-for-byte identical to the base. No finding remains unresolved.
The reviewer remains available in terminal
`term_a29891a0-1a5a-4211-a41a-dbb71291e0fd` until merge approval.

## Delivery boundary

Merging, tagging, publication, and deployment are separate authorized actions.
The release PR requires explicit human merge approval after it exists. Hosted
clients receive these changes only after `@githits/mcp` is released and the
separate remote-mcp repository adopts and deploys it. The local MCP validation
does not prove that rollout. The registry publisher binary was unavailable
locally; package/registry version contracts passed, but standalone publisher
validation was not run.
