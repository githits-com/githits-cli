# Public output formats

User-approved scope: every format-selectable MCP tool exposes only text/json,
default text. Parameter guidance recommends JSON only for programmatic follow-up
or exact structured details. No alias language. Re-run three CI Braintrust evals.

Verified: 16 tool modules plus local-agentic-ask advertise text-v1 today; server
and callable tests enforce it. Removing that public enum value is intentional.
The shared MCP descriptor owns caller format selection, while text-v1 may remain
an internal renderer name. No new abstraction is needed for these literal edits.

Sequence:
1. Delegate mechanical schema/type/predicate/format-description edits in those
   17 modules. Root owns decisions, tests, shared guidance, documentation.
2. Root updates descriptor/callable/parity tests and public guidance; preserves
   tool-specific exact-detail constraints, reviews delta inline, runs tests,
   build, generation checks and live smokes. No new reviewer (user single-pass policy).
3. Commit/push to PR359; trigger three fresh pipeline executions at new SHA,
   retain each artifact before next retry, inspect normalized Braintrust rows and
   tool format use against main and previous PR runs. No quality scorer assumed.
4. Transfer final findings to implementation docs and delete this plan.

Assumptions: same pipeline workload matrix remains appropriate; verify model,
CLI version, prompts and baseline identity in exported results before comparison.
No release, deploy or merge authorized. Existing calls using explicit text-v1
will fail schema validation; text and omitted format remain supported.
