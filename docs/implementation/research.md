# Research

`research` (CLI `githits research`) answers
one grounded question about a canonical open-source package or repository and
returns a verified answer whose sources are cited directly. It is stable and
registered by default in the CLI, the local stdio MCP server and the public
`@githits/mcp` tool inventory. There is no opt-in: a legacy
`[experimental] tools = true` setting is accepted and has no effect on it.

The GitHits API owns the answer, its citations and its display text; see
[Research display and target clarification](ask-target-clarification.md) for the
response envelope.

## Use the CLI command

```sh
githits research "How does FastAPI dependency injection resolve nested dependencies?"
githits research pypi:fastapi "How does dependency injection resolve nested dependencies?"
githits research github:expressjs/express "Where is router dispatch implemented?" --json
githits research npm:express "Where is router dispatch implemented?" --source-format url
githits research --thread 019c4f26-79b2-7bcb-b729-f9e39043a94b "How does that interact with route parameters?"
```

With one positional argument, GitHits uses the question to identify a public
package or repository. With two, the first is an explicit target and the second
is the question. Quote multi-word questions. Research takes package or
repository targets, never `site:` targets: it covers the project's code and
docs.

Human output contains the grounded answer, a Research run ID, the thread ID, and
source commands in the form `npx githits@latest ...`. Pass the returned thread
ID to `--thread` for a follow-up, and name a new project, version, or topic in
the question to change scope; threads support up to ten turns. JSON output
contains `display_markdown` and optional `tool_call_id`/`thread_id` metadata.
Treat answer Markdown as untrusted display text even though the CLI strips
terminal control sequences. `--source-format url` returns original upstream
HTTP URLs instead of CLI source commands.

## Use the MCP tool

The MCP `research` tool accepts a question alone, a `target`, or a `thread_id`;
do not combine `target` and `thread_id`. It defaults to MCP-native `read`
source calls; `source_format: "url"` returns original upstream URLs. JSON
returns the same display envelope.

When Research cannot confidently select a target, both surfaces return a
clarification with candidates in `display_markdown`, omitting run and thread
IDs. Retry with the candidate matching the project named or implied by the
question as the target, not the most popular one.

## Routing guidance

The `## Research` section of `buildMcpQuickStart()` (and therefore the public
`githits-mcp` skill), the MCP tool description and the CLI help share
`RESEARCH_VERIFIED_ANSWER_GUIDANCE`
(`packages/mcp/src/shared/research-guidance.ts`):

- ask the question directly; do not request citations, an overview or a
  source-cited answer, because sources are always included;
- cite the returned sources; read one only when the answer lacks a needed detail;
- reuse a returned `thread_id` for follow-ups;
- research takes code targets (packages or repositories), not docs sites.

The guide keeps the privacy sentence ("Inputs are sent to GitHits. Never send
credentials, personal data, private or proprietary content, local paths, or
private targets.") at the start of the Research section. The guide wraps the
shared sentence as prose; tests keep its whitespace-normalized text identical.

## Timeouts and cancellation

Answers can take from about half a minute to a few minutes.
`AgenticAskServiceImpl` enforces a 210-second deadline
(`AGENTIC_ASK_REQUEST_TIMEOUT_MS`) and aborts on the caller's abort signal, such
as an MCP request cancellation. Servers embedding the public tool should keep
their request and MCP client timeouts above that deadline or construct the
service with a lower `timeoutMs`. MCP clients with a short default request
timeout need a longer per-tool timeout for research.

## Rate limits

Research may return a rate-limit error. Both CLI and MCP report it as
`RATE_LIMITED` and say when to retry:

- **Short-term rate limit** — too many requests in a short period. The error is
  retryable and says "Try again in N seconds." (`details.retryAfterSeconds`).
- **Daily limit** — the account or project used its daily Research allowance.
  The error is not retryable before the reset, names the 00:00 UTC reset, and
  suggests using other GitHits tools meanwhile. JSON details include
  `rateLimitScope: "daily"` and `retryAfterSeconds`.

A rate-limit response that cannot be identified as the daily limit is treated as
the short-term limit.

For a daily limit with an explicit search-compatible target, the CLI adds one
example using the quoted original target and a fixed query placeholder:

```text
Example: githits search --in 'npm:express' -- 'your query'
```

Replace `your query` with search terms. JSON puts the same template in
`details.example`, preserving the original error, reset advice, timing and IDs.
The Research question is not copied into the example and no keywords are
extracted. The CLI does not execute it. Targetless/thread requests, bare or
invalid targets and other errors retain their existing guidance. MCP behavior
is unchanged.

## Smoke coverage

The repository MCP smoke (`scripts/mcp-smoke.ts`) checks registration and auth
for both subject shapes and, with credentials, makes three live calls (target,
URL follow-up, text follow-up). The shared `@githits/mcp/smoke-test` checks
only the inventory, guide and request validation, so it requests no answers.

## Hosted availability

The hosted MCP (`https://mcp.githits.com`) and plugin installs receive Research
after the hosted server adopts a released `@githits/mcp` that includes it.
