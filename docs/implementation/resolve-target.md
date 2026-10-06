# Target resolution

`resolve_target` and `githits resolve` are stable default surfaces in this source
version. Research remains experimental. Backend discovery/ranking owns identity
and confidence; the client preserves its result and determines continuation.

Resolve a noncanonical name before calling another GitHits command:

```sh
githits resolve "testing library for react" --query "upgrade component tests"
githits resolve requests --registry pypi --prefer-kind package --json
githits resolve "Express docs" --prefer-kind site
```

Canonical targets such as `npm:express`, `github:expressjs/express`, or
`site:expressjs.com` do not need resolution. Passing a target already accepted
by downstream tools is rejected locally with `INVALID_ARGUMENT`; pass that
target directly to the next GitHits tool instead. A selected site candidate is
a standalone documentation target. Search it in docs mode and read relevant
results with `read` (or `githits read`):

```sh
githits search "router parameters" --in site:expressjs.com --source docs
```

Structured output preserves each candidate's latest-version malicious-content
decision. Text stays silent for `clear` and `not_applicable`; affected, uncertain,
or unsupported decisions produce a concise warning, red in the terminal.
Affected and uncertain warnings link the bounded, status-relevant `MAL-*`
advisories returned by the resolver and explain uncertain classification reasons.
Ordinary continuation is offered only for a non-ambiguous `EXACT`/`HIGH`
identity with `clear` or `not_applicable` status. Other or missing decisions are
non-actionable and suppress the normal next-tool handoff. `clear` is not a
vulnerability-free claim.

## Public MCP composition

`McpToolServices` requires `resolveTargetService`. Remote providers construct the
existing `ResolveTargetServiceImpl` from `@githits/mcp/client` using their OSS
endpoint and request-scoped token provider, with the same client headers and
optional diagnostics as their other service clients. Resolver service, params,
result, candidate and malicious-content types are exported there. The factory
and `ResolveTargetMcpArgs` are available from `@githits/mcp/tools`.

The stable registry and smoke inventory contain 14 tools, including one resolver.
Experimental opt-in adds Research only. No GraphQL fields, ranking, authentication,
continuation gates or output envelopes change. Compact requests still omit
JSON-only details; verbose text adds only lexical-similarity evidence. The stable
routing guide and public MCP skill carry the same guidance.

## Accepted launch evidence and limits

The user accepted production quality on 2026-10-06. A fixed 255-case corpus had
49/49 core package matches, no unexpected resolver errors, and 11 successful
inventory checks. Eight inputs across JSON/text/verbose/direct service calls
(32 calls) agreed on identity and continuation gates. React repository preference
returned HIGH `github:react/react`; the unrelated ASGI suggestion for Cloudflare
documentation was gone. Client baseline was `564e6b6`; this audit does not prove
new package composition. It did not measure load/rate limits or verify deployed
backend commits or live unsafe fixtures. GA promotion checks the client delta.

Coverage remains bounded: docs.rs and Cloudflare standalone sites can be absent;
Swift kind preference is soft; GNU Emacs core on unsupported Savannah is not
covered by Emacs-binding candidates. Docker's MEDIUM SDK result without a kind
preference is accepted; Engine repository preference selects Moby. The MCP
ambiguity header now reports the backend reason without claiming multiple
visible candidates. Pydantic docs were
readable/searchable from a stale index while refresh completion was unverified.
These accepted findings are recorded in [the backlog](../backlog.md).

## Release and hosted rollout

Package-source readiness is separate from published/hosted availability.

- [ ] Merge the reviewed promotion PR with direct human approval.
- [ ] Prepare a coordinated CLI/MCP minor release from pending fragments. Update
  behavior-dependent CLI code/package skill guidance on that release branch;
  preserve the same-PR MCP stable-guide parity exception. Record exact versions.
- [ ] Obtain separate required release/publish authorizations and publish through
  the existing workflows. Opening a release PR does not authorize its merge.
- [ ] Have the specifically authorized `remote-mcp` lane adopt the released package
  and supply the public resolver client in request-scoped composition. Record its
  revision and passing released `runMcpSmoke()` evidence; no private imports.
- [ ] Deploy with separate direct human approval. Verify hosted `tools/list`
  advertises one resolver, `quick_start` includes stable guidance, authenticated
  text/JSON and selected-target inventory work, auth errors remain correct and
  Research stays outside the stable surface. Check the existing plugin connection;
  its hosted URL and transport stay unchanged.

Rollback uses the existing package/deployment process and its authorization
boundary. No promotion-specific flag, fallback or new infrastructure is added.

## Promotion verification

New live verification used the dev preset with inherited endpoint overrides
removed; the accepted production corpus remains prior ranking evidence.

- `bun run typecheck`, `bun run lint`, `bun run format:check`,
  `bun run plugins:generate`, `bun run plugins:check` and `bun run build` passed.
- `bun test` passed: 5,485 tests across 233 files, zero failures. Existing
  malicious-status, confidence, ambiguity and compact-wire-selection coverage
  remains intact; new checks cover default public execution and registration.
- `bun run validate:packages` passed: external packed `/client` and `/tools`
  imports, required provider typing, stable resolver invocation, browser bundling,
  and public-artifact isolation. Resolver helpers use the existing private core
  browser entry for neutral errors/constants, preserving `/tools` compatibility.
- Authenticated dev `bun run smoke:cli` and `bun run smoke:mcp` passed, including
  stable resolver text/verbose/JSON, selected-target inventory and CLI/MCP JSON
  parity. Experimental Research MCP checks passed separately. macOS Keychain is
  unavailable under the smoke's disposable HOME; credentials were supplied only
  through child-process environment, without printing or persisting them.
- `bun run smoke:cli:built` and `bun run smoke:mcp:built` passed under Node with
  secret-free auth/help/registration checks. These ran after package builds;
  an earlier concurrent launch saw a transient missing build artifact.

Six local dev agent runs used the unchanged workloads without experimental
flags. Fuzzy resolution used descriptors; site and canonical Express used full
guidance. Traces, final answers, metrics and validation records were inspected:

| Agent/workload | Observed route | Final confidence |
| --- | --- | --- |
| Claude / fuzzy `lodahs` | `quick_start`, resolver, package facts, grep/read; distinguished literal removed package from inferred lodash and disclosed repository snapshot limits | medium |
| Codex / fuzzy `lodahs` | Used web evidence; zero GitHits calls, so this run does not prove resolver discovery | medium |
| Claude / Express docs | Resolver, docs search; explicitly chose the MEDIUM site and disclosed snippet-only evidence | medium |
| Codex / Express docs | Resolver, docs search/read using the returned site/page locator; retained identity uncertainty | medium |
| Claude / canonical Express | List/grep; preserved evidence limits | medium |
| Codex / canonical Express | Search/list/grep/read; canonical target skipped resolution | high |

All six final runs produced structured answers and zero recorded isolation
violations or GitHits CLI calls. Claude had 8/2/3 recorded MCP call events;
Codex had 0/3/10 logical MCP calls for fuzzy/site/Express respectively. Claude's
adapter does not provide logical-call/token/cost metrics; those remain unknown.
Codex recorded uncached/cached/output tokens of 91,374/449,024/2,793,
43,590/101,888/1,351 and 23,738/166,912/1,448. Cost estimates were about
$0.0150/$0.0061/$0.0048; the fuzzy estimate cannot attribute long-context pricing.
These are neutral traces, not graded quality or a discovery-success rate.

An initial Claude fuzzy run emitted invalid final JSON despite usable tool
traces; one rerun produced the structured answer. An initial Codex Express run
failed at model capacity before calls; one rerun completed. Earlier unconfigured
agent launches had no authentication/eval-home setup and are excluded. Local
artifacts are under `.agent-eval/resolve-ga-2026-10-06/` and remain untracked.

Review completed on 2026-10-06: Luna preflight marked the Phase 1 acceptance
criteria met; internal code review found no issues. Claude Opus 5.5 round 1
found no code issues. Three minor wording findings were applied, with a bounded
scan of related smoke labels, CLI help and historical guidance. The round is
clean under the minor-wording policy. The final help wording was checked through
`bun run src/cli.ts --help`, and the build passed again. The temporary plan was
retired in the promotion PR; the rollout checklist above remains authoritative.

## Guidance refinement

The resolver's standalone discovery sentence is 79 characters:
“Resolve OSS dependency names to canonical package, repository, or docs targets.”
It frames selection around OSS dependency identity within the first 80
characters. The catalog contracts cover the raw prefix and complete sentence.

Selected schemas own argument syntax, defaults and per-argument privacy.
quick_start routes between tools and retains continuation/security rules; the
public MCP skill embeds that exact guide and suppresses a duplicate quick_start
call when loaded. Canonical provider syntax, text/JSON policy and docs read
locators now appear in their shared guide sections rather than being repeated
in the resolver paragraph. Confidence/security rules deliberately remain in the
standalone descriptor and guide so either entry point has the selection boundary.

Exact UTF-8 size measurements used `scripts/agent-context-load.ts` on the same
content blocks; these are text sizes, not provider token counts:

| Content | Before | After |
| --- | ---: | ---: |
| Resolver description | 1,121 | 580 |
| Resolver definition including unchanged schema/annotations | 3,342 | 2,799 |
| quick_start guide | 7,807 | 7,551 |
| Public MCP skill file | 8,338 | 8,082 |

Real dev `lodahs` and `Express docs` output confirmed bounded grouped evidence.
The MCP formatter now gives uncertainty/empty-result instructions once and
reports the backend ambiguity reason without asserting multiple visible
candidates. Fixed formatter fixtures used a CLEAR `npm:express` package with
one description; variants changed only confidence, ambiguity, empty targets or
UNKNOWN malicious-content status. Measured bytes were EXACT 177→177,
MEDIUM 210→170, ambiguous singleton 365→237, empty 257→145 and blocked 226→226.
Warnings, actionable target locators, JSON, queries and selection gates remain
unchanged. The singleton wording backlog entry is resolved by this client fix;
backend ambiguity classification is unchanged.

Four unchanged dev workloads were repeated with local MCP: fuzzy resolution
used descriptors, docs-site resolution used full guidance. Claude fuzzy used
quick_start/resolver/grep/read (4 calls); Claude site used resolver/docs search
(2 calls). Both kept MEDIUM identity uncertainty; Claude source evidence came
from a repository read and site evidence from search snippets. Codex fuzzy
again used web with zero GitHits calls, so it does not demonstrate resolver
discovery; its neutral answer reported HIGH confidence but explicitly separated
inferred identity from source evidence. Codex site used two resolver calls,
docs search and two reads (5 logical calls), kept MEDIUM identity uncertainty,
and replayed emitted HTTP(S) docs locators. Both full-guidance runs omitted a
quick_start call. All four structured answers succeeded with no recorded
isolation violations or CLI calls. No quality grading or causal improvement is
claimed; fewer text bytes do not establish fewer total model tokens.

Claude adapter token/cost metrics remain unavailable. Codex fuzzy recorded
73,079 uncached / 359,168 cached / 2,148 output tokens; site recorded
33,415 / 153,856 / 1,534. These are whole-run observations. Estimated costs were
$0.0120 and $0.0056 respectively; fuzzy long-context pricing is not attributable.
Artifacts are ignored under `.agent-eval/resolve-instructions-2026-10-06/`.

Refinement checks passed: full `bun test` (5,486 tests, zero failures, 233 files),
typecheck, lint (nine existing warnings), format check, plugin generation/check,
build and secret-free built Node CLI/MCP smokes. Catalog/guide/formatter/parity
checks passed (139 tests); local catalog and smoke assertions passed (180 tests).
The smoke assertions now check both explicit choice and no automatic selection.
Initial checks caught stale local-catalog and smoke wording expectations; these
were corrected and affected checks rerun. Authenticated dev stable CLI/MCP
smokes passed, including resolver text/verbose/JSON and selected-target inventory.
The unchanged experimental Research cohort also passed.

Refinement review completed on 2026-10-06. Internal review's optional actionable candidate
qualifier was restored in guide/skill; its 25 targeted tests passed.
Claude Opus 5.5 refinement round 1 found a small missing filter-narrowing remedy
and minor release/doc wording; all were fixed. The sole ambiguous Next action
now retains "name or filters", with 159 affected tests passing. Internal
re-review and Claude round 2 were clean. Claude's single fresh-context final
check confirmed preserved gates, warnings, locators and narrowing remedies.
Cosmetic reflow/test-literal suggestions were set aside; they did not identify
a behavior or contract defect. Build and plugin checks passed again. The
refinement plan was retired in the final commit after clean review.

The user subsequently requested OSS dependency framing rather than a vague or
misspelled-name trigger. The descriptor, route row and guide/skill paragraph now
state that task; the table above records the updated sizes. Known canonical
targets still skip resolution. Argument schemas, continuation gates, output and
ranking remain unchanged. Earlier trace observations describe the prior wording
and do not establish performance or discovery gains for this correction.

Dependency-framing rechecks passed: 70 focused catalog/guide/adapter/skill tests,
full `bun test` (5,486 passing, zero failures), plugin generation/check, build,
format check, MCP registration smoke and CLI unauthenticated smoke. Prior live
body/JSON checks remain applicable because only discovery/routing wording changed.
Two new local dev traces used Claude descriptor-only fuzzy resolution and Codex
full-guidance site resolution. Claude called quick_start/resolver/grep/read
(4 recorded events); Codex called resolver twice, docs search and three reads
(6 logical calls), without quick_start. Both distinguished MEDIUM identity
inference from subsequent evidence; both produced structured answers with zero
recorded isolation violations or CLI calls. Claude usage remains unknown;
Codex recorded 30,808 uncached / 114,176 cached / 1,427 output tokens, estimated
$0.0049 for the whole run. These are neutral observations, not a quality grade or
causal token/discovery improvement. Artifacts are ignored under
`.agent-eval/resolve-dependency-framing-2026-10-06/`.

Dependency-framing internal review and Claude Opus 5.5 refinement round 3 were
clean, including the permitted fresh-context check after the user correction.
The reviewer verified the complete 79-character sentence and guide/skill parity;
no schema, runtime or continuation-gate change was found.
