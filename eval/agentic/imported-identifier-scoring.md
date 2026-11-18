# Imported identifier investigation scoring

Apply this rubric after the [imported identifier probe](probes/imported-identifier-investigation.md)
completes. Keep this answer key outside the agent-facing prompt. Use
`final.json` and the tool responses in `stdout.json` to verify factual claims,
`tool-calls.json` to verify arguments and order, and `metrics.json` for call
counts. Report harness validation separately from factual scoring.

Score each factual item **verified**, **unsupported**, **missing**, or
**incorrect**. Award credit when the final answer states the fact and the
trace supplies direct evidence from the expected snapshot. Record efficiency
separately so a short, incomplete answer cannot outrank a complete one.

| Dimension | Evidence and scoring rule |
| --- | --- |
| Locations and snapshot | Require `lib/application.js:26` and `lib/express.js:19`, each importing `router`, and attribution to Express 5.2.1 served from `dbac741a49a5a64336b70c06e85c2e2706e36336`. Accept the unambiguous `dbac741a` locator. Flag a served snapshot mismatch separately from an agent factual error. |
| Lazy creation and reuse | In `lib/application.js`, require evidence that `app.init` initializes `router` to `null` at lines 59–60 and installs the getter at 68–82. The getter constructs and stores a `Router` only while the variable is `null`, then returns the stored instance. `new Router` alone supports construction, but does not establish the getter or reuse. |
| Routing settings | Require both mappings at `lib/application.js:75–76`: `caseSensitive` comes from `this.enabled('case sensitive routing')` and `strict` comes from `this.enabled('strict routing')`. |
| Public exports | Require both assignments at `lib/express.js:70–71`: `exports.Route = Router.Route` and `exports.Router = Router`. Score each independently. |
| Answer completeness | Mark complete only when all required facts are verified, the answer cites the correct supporting source files and line ranges, and it describes material coverage limits accurately. Record any extra unsupported claims separately. Self-reported confidence earns no credit. |
| Unnecessary reads | Classify each read against the evidence available before it. A read that fills a specific gap earns credit. A read that only repeats visible imports or misses the claimed usage is avoidable. Record broad ranges that yield a needed fact as useful but oversized. Record total evidence calls, ranges, and response bytes. |
| Identifier lookup scope | Score initial import discovery separately from usage follow-up. Once the import sites are known, record whether further identifier lookups target the importing files or the whole package. A narrow read or another route that supplies the facts can earn full correctness without an identifier lookup. |
| Continuation handling | Record whether the tool offered a continuation, which scope remained incomplete, and whether the agent used it. Credit stopping when the requested evidence and relevant coverage are sufficient. Credit continuation when it resolves a material gap. Flag needless paging or an exhaustive claim made from bounded evidence. |
