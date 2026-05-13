# Vendored prompt-injection corpus

`prompt_injections.csv` is vendored from
[`pr1m8/prompt-injections`](https://github.com/pr1m8/prompt-injections)
(MIT, Copyright (c) 2025 Will). The upstream LICENSE is preserved here
as `LICENSE.upstream`.

We commit the file directly rather than fetching it at run-time so the
harness is offline-runnable and produces stable results across machines.

To refresh from upstream:

```sh
gh api repos/pr1m8/prompt-injections/contents/prompt_injections.csv \
  --jq '.content' | base64 -d > eval/fixtures/source/prompt_injections.csv
```

The CSV columns are `id, text, category, subcategory, language, target,
complexity, source, effectiveness` — see the upstream README for field
semantics.

`eval/fixtures/attacks.ts` cherry-picks a subset of these and adapts
each to embed a unique compliance marker the judge can regex against.
The original CSV is never modified.
