# Update Check

## Purpose

The CLI warns users when their installed `githits` package is behind the npm
`latest` dist-tag. This supports sticky installs such as `npm i -g githits`
without introducing forced updates, backend policy, or automatic package-manager
execution.

## Background

Generated MCP configs already run GitHits through:

```sh
npx -y githits@latest mcp start
```

That path asks the package manager for the latest published version at startup.
The update checker targets long-lived local/global installs where the binary
stays on the installed version until the user updates it.

## Behavior

The check is advisory only:

- it never blocks the command
- network, cache, and parse failures fail open silently
- notices are written to stderr only
- stdout is never touched
- every eligible invocation reports the stale version once a newer npm `latest`
  is known

The notice format is:

```text
Update available: githits 0.2.0 -> 0.3.0
Run: npm i -g githits@latest
```

## Registry Source

The checker fetches npm dist-tags directly:

```text
https://registry.npmjs.org/-/package/githits/dist-tags
```

Only the `latest` field is used. The CLI does not shell out to `npm info`,
because subprocess behavior depends on the user's package-manager setup and is
slower than one HTTPS request.

## Cache

Update-check state is stored under the XDG config location:

```text
~/.config/githits/update-check.json
```

When `XDG_CONFIG_HOME` is set, the path is:

```text
$XDG_CONFIG_HOME/githits/update-check.json
```

The directory is created with mode `0o700`; the cache file is written with mode
`0o600`. The cache contains no credentials.

Cache shape:

```json
{
  "checkedAt": "2026-04-28T12:00:00.000Z",
  "latestVersion": "0.3.0"
}
```

The CLI checks npm at most once every 24 hours. If the cached latest version is
newer than the running CLI, the notice is printed on every eligible invocation.
When the cache is stale, the CLI refreshes npm first and falls back to the cached
notice if the refresh fails. A missing or malformed cache is treated as stale.
Concurrent writes use last-writer-wins semantics, and redundant fetches from
racing processes are acceptable.

## Eligibility

The CLI decides eligibility from raw argv and process state before Commander
parses the command.

Checks are skipped for:

- help and version invocations
- CI
- non-TTY stderr
- truthy `GITHITS_DISABLE_UPDATE_CHECK`
- likely ephemeral package-runner invocations (`npx`, `bunx`, npm/bun `exec`)
- MCP stdio server invocations

MCP has two forms:

- `githits mcp start` always starts the stdio server and is skipped
- `githits mcp` starts stdio when stdin or stdout is non-TTY and is skipped
- interactive `githits mcp` shows setup instructions and remains eligible

## Implementation

Key modules:

| File | Purpose |
|---|---|
| `src/services/update-check-service.ts` | Registry fetch, cache handling, eligibility helpers, notice formatting |
| `src/cli/update-check.ts` | Cancellable background task and post-command stderr notice |
| `src/cli.ts` | Starts and flushes the update-check task around Commander parsing |
| `src/services/update-check-service.test.ts` | Service and eligibility coverage |
| `src/cli/update-check.test.ts` | CLI orchestration coverage |

The service accepts injected dependencies for the current version, fetcher,
clock, and file-system service. Tests should mock those dependencies rather than
patch global state.

## Future Work

This mechanism is not a hard compatibility gate. Future phases can add:

- CDN-hosted version policy with `recommended` and `minimumSupported`
- recurring checks for long-running MCP servers
- `githits update`
- backend `426 Upgrade Required` enforcement
