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
preference is accepted; Engine repository preference selects Moby. Some singleton
ambiguous results still say multiple candidates remain. Pydantic docs were
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
