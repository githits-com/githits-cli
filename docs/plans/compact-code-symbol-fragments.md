# Compact Code-Symbol Fragments

## Status

- Draft PR [#414](https://github.com/githits-com/githits-cli/pull/414) is open. The user-identified ownership correction is pushed and externally reviewed.
- Owner: `githits-cli` read client, CLI command, and public MCP package.

## Verified contract and assumptions

- The user verified deployed development GraphQL `read` returns `CodeContextResult` for `npm:express@5.2.1#createApplication`, matching the explicit-selector read; the original CLI instead took the docs branch and reported `PROTOCOL_ERROR`.
- The backend `read` query returns a typed union: `CodeContextResult`, `GetDocPageResult`, or `CodeSymbolResolutionResult`. Direct dev GraphQL returned docs and code result types for known docs and symbol targets, respectively, even with `waitTimeoutMs: 0` supplied.
- Direct dev error probes returned `extensions.code` without a result type: `VALIDATION_ERROR` for empty/conflicting code fragments, `DOCUMENTATION_SECTION_UNRESOLVED` for a missing docs heading, and `NOT_FOUND` for a synthetic ambiguous locator. These codes support error mapping without guessing source from the target.
- Before the ownership correction, `ReadServiceImpl` predicted a source from target syntax and rejected a typed backend result that contradicted the prediction. CLI and MCP also sent pathless requests without an explicit selector through docs-only adapters. These client decisions prevented the backend from owning source resolution.
- Existing repository documentation page IDs use `provider:owner/repo@ref/path`; an optional trailing heading fragment must remain documentation. This shape is ambiguous with refs containing `/`. The backend must decide it from the unified read contract; the client cannot infer the source from the spelling alone.
- Search can also emit refless GitHub documentation page IDs such as `github:owner/repo/README.md`; the backend must resolve those page IDs and their heading fragments as docs. Codeberg uses the same owner/repository path shape.
- Direct dev reads of absolute HTTP(S) URL fragments without an explicit code selector or path returned documentation, including provider roots. The client does not enforce that source from URL spelling. Targets and percent escapes are passed unchanged; only the backend decodes fragments.

## Design and ownership

The backend resolver owns source selection because it has the target and returns an explicit result type. `ReadServiceImpl` owns transport and parsing that type. CLI and MCP own validation and presentation based on the returned type. For GraphQL failures without a result type, `DOCUMENTATION_SECTION_UNRESOLVED` uses the docs error constructor; all other backend codes, including shared codes and absent codes, use the code error constructor to retain available versions, repository refs, and recovery metadata. The shared `FORBIDDEN` code needs a source-neutral access-denied message because the code constructor hard-codes code-navigation wording. Transport, HTTP, and malformed-response errors reuse the existing code error family with source-neutral read-service messages; no new error classes are needed. A raw fragment may be inspected for a code or symbol-resolution result's follow-up text only after the backend has identified that result. Exact-path and legacy `--repo-url` behavior retain their existing specialized file-read presentation. No new transport, lookup, or retry is needed.

## Ownership correction: next increment

- **Status:** implemented and reviewed; the draft PR remains unmerged. **Outcome:** Pathless normal CLI/MCP reads accept the backend's code, docs, or symbol-resolution result even when the target string resembles another source.
- **Assumptions:** Backend `__typename` is authoritative for successful unified reads; verified for known dev code and docs targets. Backend resolution for a valid slash-bearing ref that also spells a documentation page ID has not been demonstrated; this client increment will not prescribe that backend choice.
- **Product decisions:** none for this client increment. The user directed backend-owned source resolution. Backend policy for a genuinely ambiguous valid target remains backend-owned and outside this worktree.
- **Dependencies:** Deployed unified `read` union and existing shared formatter. No new infrastructure.
- **Implementation:** Accept each typed backend result in `ReadServiceImpl` without checking a guessed source. Keep raw target and optional path/selector/bounds, including wait, available to the backend. Route pathless CLI/MCP reads through `ReadService.read`, then render code/docs/resolution by result type. CLI pathless validation accepts either `--lines` or `--start`/`--end` and rejects `--git-ref` without `--repo-url`, without calling a pathless target docs in advance. GraphQL `DOCUMENTATION_SECTION_UNRESOLVED` uses the docs error constructor; all other codes use the code constructor, with neutral wording for `FORBIDDEN`. Transport/HTTP/protocol errors reuse the code error classes with neutral messages. Preserve exact-path caps and legacy `--repo-url` file semantics. Avoid cross-source retries. Remove stale client precedence claims from help, instructions, and implementation docs.
- **Acceptance:** Tests prove a docs-shaped target can return code and a code-shaped target can return docs; pathless CLI/MCP calls present both correctly. A docs-shaped target with a code indexing error retains `INDEXING`; a code-shaped target with a docs section error retains `DOCUMENTATION_SECTION_UNRESOLVED`; pathless `VERSION_NOT_FOUND` and `NOT_FOUND` preserve code recovery details; transport/HTTP/protocol failures have neutral read messages. A pathless CLI target that resolves to code accepts `--start`/`--end`. Existing fragment/selector parity, docs fragments and page IDs, exact-file, legacy, invalid/conflict, and follow-up behavior remain covered. Focused tests, build, CLI/MCP smoke, direct dev probes, a clean review round, and PR CI pass.
- **Completion:** Update permanent implementation docs and the existing release fragment, then keep this temporary plan until PR merge. After merge, transfer any remaining durable details and delete the plan under the repository's plan lifecycle.

## Acceptance

- Compact registry and repository `target#symbol` reads, including optional exact paths, use `Query.read`; backend code results match explicit-selector content.
- Absolute HTTP(S) fragments and repository page IDs retain backend documentation outcomes; explicit `--selector`, exact-file reads, and legacy commands retain behavior.
- Invalid and conflicting fragments produce one coherent error, without docs fallback.
- CLI help, MCP description/schema/instructions, stable public guide, tests, and release fragment agree.
- Focused tests, build, required smoke, and live development checks pass; the revised PR receives a clean review round and green CI.

## Verification to date

- Ownership correction: 146 focused tests pass across read service, CLI/MCP read, presentation, descriptors, and skill parity. The full suite passed with 4,927 tests before the final neutral typed-parser error fix; its two targeted new cases pass. Typecheck, format check, lint, root/MCP builds, public package validation, and plugin generation/check pass.
- Refreshed CLI live dev smoke passed both stable and experimental cohorts, including fragment/selector and documentation-fragment CLI/MCP JSON parity. MCP stable live cohort passed; the unrelated experimental `research` URL JSON case hit the SDK's 60-second request timeout. Direct CLI and local MCP dev probes both returned `INVALID_ARGUMENT` for empty/conflicting fragments and `DOCUMENTATION_SECTION_UNRESOLVED` for a missing docs heading.
- Targeted Claude descriptor agent eval ended in an API error before any tool call; its artifact has zero tool calls and no final answer. Qualitative behavior remains unmeasured by that run.
- Internal pre-flight found that malformed typed branches retained legacy source-specific messages; the shared read service now maps those parser failures to a neutral malformed-read error while preserving indexing errors. Two targeted malformed-branch tests pass.
- Internal code review found no issues in the complete PR delta. The retained external Claude reviewer found no code issues and three minor wording mismatches, corrected in the MCP test name and plan/implementation docs; the targeted MCP read tests pass (52), and the review policy counts this round as clean after those wording fixes. Refreshed PR CI passed all required checks on the code correction; the final PR head is subject to the same CI checks.
- Focused read, formatter, and descriptor tests: 123 passed after external review round 1; final MCP read/descriptor tests passed (63 tests). TypeScript typecheck passed.
- Full repository tests after external review round 2: 4,937 passed. Root and MCP package builds passed.
- CLI live dev smoke passed, including persistent fragment, selector, and docs-fragment CLI/MCP parity fixtures. Built CLI and MCP registration smoke passed.
- MCP stable live smoke passed, including a final rerun against explicit dev endpoints. Its separate experimental `research` cohort failed on a reproduced dev `TIMEOUT` (`research` returned `retryable: true` in the earlier run); the final rerun timed out on experimental research URL JSON. A separate smoke attempt with the default endpoint timed out on live `pkg_info`, while unauthenticated and registration checks passed. None of these failures exercise fragment read.
- Direct dev CLI and local MCP reads of `npm:express@5.2.1#createApplication` matched explicit-selector content and exact file path. A percent-encoded fragment matched the unencoded result. A search-emitted HTTP(S) docs fragment and repository docs page ID returned docs in both clients. Empty and conflicting fragments returned `INVALID_ARGUMENT` in both.
- Targeted Codex and Claude agent eval attempts made zero tool calls because the local model sessions did not start successfully; this is an eval-environment limitation, not a passed qualitative result. A descriptor-only Codex rerun after the final wording fix also made zero calls because the configured model hit its usage limit.
- Internal pre-flight review found the slash-ref plus exact-path presentation gap; its follow-up was clean. A second internal closure pass after external findings was also clean.
- External review round 1 found that symbol-miss search actions and code continuations incorrectly kept the fragment, and that refless repository docs page IDs could be misclassified. Both were corrected in the shared formatter/classifier and related tests before round 2. Live dev CLI/MCP symbol misses now emit base-target search actions.
- External review round 2 closed both earlier findings, then found that a `--repo-url` file path resembling `target#symbol` could trigger fragment routing. CLI now skips compact-target detection in `--repo-url` mode; focused read tests passed (110 tests across three affected files), including the legacy and explicit-selector branches. The full suite passed (4,937 tests), and the root build passed.
- Internal pre-flight found no further issues after the `--repo-url` correction. External review round 3 found no code issues and one minor MCP field-description gap: it did not state that an exact path narrows a fragment read or that `selector` conflicts with a compact fragment. Both descriptions were corrected, and MCP read/descriptor tests passed (63 tests). Under the review policy, this is a clean round after the wording fix.

## Backend boundary to report

A genuinely ambiguous target such as `provider:owner/repo@release/v1#symbol` can still require a backend resolution rule. This client PR will report the backend's typed outcome instead of enforcing docs precedence. No backend repository changes are in scope for this lane.
