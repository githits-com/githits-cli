# Compact Code-Symbol Fragments

## Status

- Implementation and external review complete on 2026-09-24; draft PR [#414](https://github.com/githits-com/githits-cli/pull/414) is open for CI and user review.
- Owner: `githits-cli` read client, CLI command, and public MCP package.

## Verified contract and assumptions

- The user verified deployed development GraphQL `read` returns `CodeContextResult` for `npm:express@5.2.1#createApplication`, matching the explicit-selector read; the current CLI instead takes the docs branch and reports `PROTOCOL_ERROR`.
- `ReadServiceImpl` owns transport source classification and maps source-specific errors. CLI and MCP own caller validation and formatting; both currently route pathless requests without an explicit selector through documentation adapters.
- Existing repository documentation page IDs use `provider:owner/repo@ref/path`; an optional trailing heading fragment must remain documentation. This shape is ambiguous with refs containing `/`, so the existing slash-bearing page-ID precedence remains the compatibility rule for pathless reads. An exact path disambiguates a slash-bearing code ref and uses symbol presentation.
- Search can also emit refless GitHub documentation page IDs such as `github:owner/repo/README.md`; those must keep docs precedence with a heading fragment. Codeberg uses the same owner/repository path shape.
- Absolute HTTP(S) URLs remain documentation locators, including provider roots. Targets and percent escapes are passed unchanged; only the backend decodes fragments.

## Design and ownership

`ReadServiceImpl` owns the compact fragment detector because it is the existing shared request-classification boundary. CLI and MCP call that detector to choose their code-capable formatter while leaving backend arguments unchanged. A simpler CLI-only branch would leave MCP and service result/error classification inconsistent. No new transport or fallback is needed.

## Acceptance

- Compact registry and repository `target#symbol` reads, including optional exact paths, use `Query.read` as code and match explicit-selector content.
- Absolute HTTP(S) fragments and repository page IDs retain documentation handling; explicit `--selector`, exact-file reads, and legacy commands retain behavior.
- Invalid and conflicting fragments produce one coherent error, without docs fallback.
- CLI help, MCP description/schema/instructions, stable public guide, tests, and release fragment agree.
- Focused tests, build, required smoke, and live development checks pass; review reaches a clean round before the draft PR.

## Verification to date

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

## Pending clarification

Pathless `provider:owner/repo@ref/segment#fragment` is syntactically ambiguous with a repository documentation page ID. Existing docs-page precedence is retained pending the user's answer; an exact path disambiguates a code symbol read. Changing this precedence would require a product decision because it can break emitted repository docs heading IDs.
