# Compact Code-Symbol Fragments

## Status

- Implementation complete on 2026-09-24; external review and PR delivery pending.
- Owner: `githits-cli` read client, CLI command, and public MCP package.

## Verified contract and assumptions

- The user verified deployed development GraphQL `read` returns `CodeContextResult` for `npm:express@5.2.1#createApplication`, matching the explicit-selector read; the current CLI instead takes the docs branch and reports `PROTOCOL_ERROR`.
- `ReadServiceImpl` owns transport source classification and maps source-specific errors. CLI and MCP own caller validation and formatting; both currently route pathless requests without an explicit selector through documentation adapters.
- Existing repository documentation page IDs use `provider:owner/repo@ref/path`; an optional trailing heading fragment must remain documentation. This shape is ambiguous with refs containing `/`, so the existing slash-bearing page-ID precedence remains the compatibility rule for pathless reads. An exact path disambiguates a slash-bearing code ref and uses symbol presentation.
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

- Focused read and descriptor tests: 115 passed after the slash-ref correction; TypeScript typecheck passed.
- Full repository tests before that correction: 4,926 passed. Root and MCP package builds passed.
- CLI live dev smoke passed, including persistent fragment, selector, and docs-fragment CLI/MCP parity fixtures. Built CLI and MCP registration smoke passed.
- MCP stable live smoke passed. Its separate experimental `research` cohort failed on a reproduced dev `TIMEOUT` (`research` returned `retryable: true`), unrelated to fragment read.
- Direct dev CLI and local MCP reads of `npm:express@5.2.1#createApplication` matched explicit-selector content and exact file path. A percent-encoded fragment matched the unencoded result. A search-emitted HTTP(S) docs fragment and repository docs page ID returned docs in both clients. Empty and conflicting fragments returned `INVALID_ARGUMENT` in both.
- Targeted Codex and Claude agent eval attempts made zero tool calls because the local model sessions did not start successfully; this is an eval-environment limitation, not a passed qualitative result.
- Internal pre-flight review found the slash-ref plus exact-path presentation gap; the revised full delta received a clean follow-up review.

## Pending clarification

Pathless `provider:owner/repo@ref/segment#fragment` is syntactically ambiguous with a repository documentation page ID. Existing docs-page precedence is retained pending the user's answer; an exact path disambiguates a code symbol read. Changing this precedence would require a product decision because it can break emitted repository docs heading IDs.
