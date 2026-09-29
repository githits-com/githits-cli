# Grep text fixture provenance

These fixtures preserve two public production grep pages captured on
2026-09-29. `mixed-100.json` covers a package search whose selected evidence
includes both Express source and hosted documentation. `repository-100.json`
covers source-only results from a pinned Express repository snapshot. Each file
is the compact formatter-input projection of its captured response and includes
the original nullable `repoUrl` and `canonicalSite` scope identities for the
shared source summary.

The exact public requests were:

```sh
githits grep router npm:express
githits grep router 'https://github.com/expressjs/express@dbac741a49a5a64336b70c06e85c2e2706e36336' --corpus source --limit 100
```

The text captures were collected with `node dist/cli.js` after `bun run build`,
against production, with `GITHITS_API_TOKEN` unset. The matching requests with
`--json` supplied the response data for the fixtures. `npm:express` also selects
its hosted documentation; the five distinct page URLs in `mixed-100.json` are:

- <https://expressjs.com/en/3x/api/application/>
- <https://expressjs.com/en/4x/api/>
- <https://expressjs.com/en/4x/api/application/>
- <https://expressjs.com/en/4x/api/express/>
- <https://expressjs.com/en/4x/api/request/>

The repository excerpt comes from the pinned
[Express repository snapshot](https://github.com/expressjs/express/tree/dbac741a49a5a64336b70c06e85c2e2706e36336).
Its upstream [MIT license](https://github.com/expressjs/express/blob/dbac741a49a5a64336b70c06e85c2e2706e36336/LICENSE)
is preserved byte-for-byte in [EXPRESS-LICENSE.txt](./EXPRESS-LICENSE.txt).
The hosted excerpts are from the Express documentation website, which states
“Copyright The Express Contributors.” and is licensed under
[CC BY 4.0](https://github.com/expressjs/expressjs.com/blob/main/LICENSE.md)
([license terms](https://creativecommons.org/licenses/by/4.0/)). These upstream
licenses apply to the excerpts; this GitHits repository remains under its own
Apache-2.0 license.

Backend safety normalization may transform text before it reaches the client;
the fixtures preserve the returned text and its selected safety-filter status.
The compact-field projection removes unconsumed response fields and duplicate
detailed text, but does not edit the source text in the selected slices. It
preserves hit order, read actions, scope attribution, and the continuation
cursor.

The original text baseline captures remain available at
`/tmp/nuckelavee-grep-ux-mixed-100.txt` and
`/tmp/nuckelavee-grep-ux-repository-100.txt`. Their pre-refinement measurements
were:

| Case | Text bytes | Text lines | `o200k_base` tokens |
| --- | ---: | ---: | ---: |
| `mixed-100.json` | 23509 | 413 | 8038 |
| `repository-100.json` | 19487 | 297 | 7506 |

Token counts were measured with external `tiktoken` using `o200k_base`; the
project has no tokenizer dependency. The checked-in
`scripts/grep-text-size-benchmark.ts` compares current formatter output against
the fixed byte baselines above. Bundle that script for Node before running it;
it reports UTF-8 bytes and lines and does not measure tokens.
