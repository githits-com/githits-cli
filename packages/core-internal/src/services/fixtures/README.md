# Research display fixtures

`ask-display-contract.json` contains representative successful API responses for
CLI, MCP, URL citations, and target clarification. Service and display tests use
these examples to verify the minimal envelope and lossless JSON behavior.

The public contract is `display_markdown` plus optional `tool_call_id` and
`thread_id`. Display sections may evolve without client changes. Update these
examples only when the intended API output changes.

## Example source fixtures

`example-display-contract.json` freezes the example response data and complete
URL, CLI, and MCP Markdown, using a public commit-addressed source. The solution
identifier is synthetic. Preserve its canonical bytes when synchronizing the
contract. `example-read-calls.json` adds generated edge-case calls for exact
paths and refs, including shell quoting and literal percent signs.

The source-contract tests exercise both example callers through the real transport,
then replay calls through a shell argument recorder, Commander, and the MCP read
handler. Read services are mocked; these tests make no external requests.
