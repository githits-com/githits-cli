# Ask display and target clarification

Every successful `/ask` response uses a minimal envelope:

```json
{
  "display_markdown": "Complete answer, citations, and follow-up guidance.\n",
  "tool_call_id": "01900000-0000-7000-8000-000000000030",
  "thread_id": "01900000-0000-7000-8000-000000000031"
}
```

The backend owns the entire Markdown, including source commands, candidate lists,
run/thread footers, and guidance. Text clients read only `display_markdown`; they
never interpret sections or reconstruct citations. Backend section additions,
removals, or reordering require no client update. Keep the display field's name/type,
accepted requests, and thread semantics backward compatible from this baseline.

A targetless lookup that needs a choice uses the same HTTP 200 shape, omitting both
IDs. The backend formats provider order, confidence, related groups, protected
matches, malicious-status evidence, and truncation notes. Empty candidates explain
how to retry. Clients do not select a target. Repeat the question with an explicit
canonical target, without a thread ID:

```sh
githits research github:openai/codex 'How does codex handle chat compaction?'
```

CLI `--json` and local MCP `format: "json"` preserve the parsed API envelope and any
future metadata unchanged. There are no response schema, source, variant, or ID
validators. Only text extraction checks that `display_markdown` is a string; missing
or non-string display becomes the existing protocol error. JSON mode intentionally
still exposes that parsed response. Invalid JSON, transport errors, cancellation,
timeouts, and the 4 MiB response cap retain their existing behavior.

CLI strips terminal control sequences while retaining Markdown newlines, tabs,
indentation, and Unicode. Local MCP returns the display string verbatim. Neither
surface executes source commands. `source_format` remains a request-only citation
presentation choice (CLI/MCP commands or upstream URLs); old structured answer/source
fields and the clarification outcome discriminator are no longer in the envelope.

HTTP 400 target errors may provide structured `detail` with `code`, `message`,
`hint`, and optional `reason`. Codes and reasons are open-ended identifiers, so
new server diagnostics do not require a client release. The shared service extracts
string `code`, `message`, and `hint` fields without format or length restrictions,
preserves extra diagnostic fields, and bounds the error body to 16 KiB.
CLI/MCP error envelopes keep
`INVALID_ARGUMENT` and add `targetErrorCode`, `hint`, and optional `reason`
to `details`. A missing resolver reason stays absent; tool-call and
thread IDs remain available as opaque response header values. CLI text sanitizes
these identifiers before displaying them. Malformed/legacy bodies use safe correction
guidance rather than displaying unstructured response content. Other HTTP errors retain their
existing safe mappings. Detailed guidance requires the matching backend update;
older clients continue working but discard those diagnostics.

Local MCP `research` accepts a question alone, or mutually exclusive `target` and
`thread_id` selectors. Follow-ups may change project, exact version/ref, or topic by
naming the new scope while retaining the thread ID. If a follow-up fails, keep the
thread ID when clarifying the question.

This experimental cutover requires coordinated backend and root CLI changes.
Prepare both, verify together, then deploy backend and release the client in the
same window. No legacy response fallback or client-version negotiation is included.
After the new baseline is available, preserve the display envelope during rollbacks.
Research is local-only; hosted MCP and the public `@githits/mcp` entrypoints do not
register it.

The shared fixture is `packages/core-internal/src/services/fixtures/ask-display-contract.json`;
service, CLI, and local MCP tests verify text and JSON against these examples.
