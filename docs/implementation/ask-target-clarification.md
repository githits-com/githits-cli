# Ask target clarification

A targetless Ask lookup that cannot choose confidently returns HTTP 200 with
`outcome: "needs_target"`, `message`, and the compact resolver result in `resolution`.
The response describes a completed lookup requiring caller input. It has no `answer_markdown`, source
pointers, run ID, or thread ID. Empty results use the same shape with no candidates.

The service validates resolver output with the existing compact resolver schema and
normalizes nullable metadata the same way as `resolve`. It rejects clarification for
an explicit target or existing thread. Response size and cancellation limits are shared
with answered responses. Other HTTP errors retain their existing safe mappings.

CLI text and the local MCP text formatter reuse the candidate section of the resolve
formatter, preserving provider order, confidence, related groups, protected matches,
malicious-status evidence, and truncation notes. They do not choose or promote a target.
CLI JSON preserves the typed resolution and `needs_target` outcome, and the command
completes successfully. Retry the question with a selected canonical target:

```sh
githits ask github:openai/codex 'How does codex handle chat compaction?'
```

Local MCP Ask accepts the same question-only lookup: omit both `target` and
`thread_id`. Text and JSON return the same clarification and candidates as the CLI.
Repeat the original question with a selected `target` to continue. Explicit targets
and thread follow-ups remain supported, but cannot be supplied together.

Deploy clients supporting this response before enabling the backend change: older
clients expect every HTTP 200 response to contain an answer and identifiers. The new
client still accepts the existing answer contract and older backend errors. Reverting
the backend restores the earlier targetless rejection behavior without a migration.
