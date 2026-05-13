# Workload: Package Upgrade Evidence Review

You are reviewing a dependency-update pull request for a TypeScript CLI/MCP
project. The PR proposes these npm upgrades:

- `@modelcontextprotocol/sdk`: `1.26.0` to `1.29.0`
- `@napi-rs/keyring`: `1.2.0` to `1.3.0`
- `zod`: `4.3.6` to `4.4.3`
- `@biomejs/biome`: `2.4.2` to `2.4.15`
- `@types/bun`: `1.3.9` to `1.3.13`
- `lint-staged`: `16.2.7` to `16.4.0`
- `typescript`: `5.9.3` to `6.0.3`

Collect upgrade evidence for this update set. Group the upgrades by observed
facts, cite concise evidence, and identify which updates need extra manual
verification or may be better split out before merging. Pay special attention to
cases where the version number alone would hide relevant changelog,
vulnerability, dependency, or compatibility evidence.
