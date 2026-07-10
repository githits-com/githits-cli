# Update Check

## Purpose

The CLI warns users when their installed `githits` package is behind the npm
`latest` dist-tag. It also uses npm deprecation metadata as a blunt kill switch
for versions that become backend-incompatible or unsafe.

## Background

Generated MCP configs already run GitHits through:

```sh
npx -y githits@latest mcp start
```

That path asks the package manager for the latest published version at startup.
The update checker targets long-lived local/global installs where the binary
stays on the installed version until the user updates it.

## Support Policy

GitHits supports the current and recent CLI versions during normal operation;
the target support window is about seven days. Older versions may continue to
work, but are not guaranteed.

When a version must stop running, maintainers deprecate it on npm with a clear
reason:

```sh
npm deprecate 'githits@<0.3.0' 'Backend protocol changed'
```

The CLI treats npm deprecation as runtime policy once observed. npm or network
failure does not break commands unless the installed version is already cached as
deprecated.

## Behavior

The check is advisory only:

- it never blocks the command
- network, cache, and parse failures fail open silently
- notices are written to stderr only
- stdout is never touched
- every eligible invocation reports the stale version once a newer npm `latest`
  is known

Required-update enforcement is separate:

- background refresh records whether the installed version is npm-deprecated
- the current command is not blocked by newly fetched deprecation metadata
- the next eligible invocation blocks from cached metadata only
- help/version and ephemeral package-runner invocations are not blocked
- CI, non-TTY, and MCP stdio invocations can be blocked because compatibility
  matters there too
- successful non-deprecated metadata clears a cached block
- fetch failures preserve any cached deprecated status and otherwise fail open

The notice format is:

```text
Update available: githits 0.2.0 -> 0.3.0
Run: npm i -g githits@latest
```

The required-update format is:

```text
Update required: Backend protocol changed

Installed githits 0.2.0 is no longer supported.
Latest known version: 0.3.0
Update with:
  npm i -g githits@latest
```

The `Latest known version` line is omitted when the advisory latest-version cache
is missing. Required-update enforcement does not fetch npm just to render this
line.

## Registry Source

The checker fetches npm dist-tags directly:

```text
https://registry.npmjs.org/-/package/githits/dist-tags
```

Only the `latest` field is used for advisory update notices. Required-update
refresh uses the installed package-version metadata endpoint:

```text
https://registry.npmjs.org/githits/<currentVersion>
```

The optional `deprecated` string is sanitized, cached, and later displayed as the
required-update reason. The CLI does not shell out to `npm info`, because
subprocess behavior depends on the user's package-manager setup and is slower
than direct HTTPS requests.

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
  "latestVersion": "0.3.0",
  "currentVersionStatus": {
    "version": "0.2.0",
    "checkedAt": "2026-04-28T12:00:00.000Z",
    "deprecatedReason": "Backend protocol changed"
  }
}
```

The CLI checks npm at most once every 24 hours. If the cached latest version is
newer than the running CLI, the notice is printed on every eligible invocation.
When the cache is stale, the CLI refreshes npm first and falls back to the cached
notice if the refresh fails. A missing or malformed cache is treated as stale.
Concurrent writes use atomic write-then-rename with last-writer-wins semantics,
and redundant fetches from racing processes are acceptable.

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

Required-update refresh/enforcement uses broader eligibility: it skips
help/version and ephemeral package runners, but not CI, non-TTY, disabled
advisory checks, or MCP stdio. This keeps compatibility enforcement effective
for automation and MCP clients while keeping advisory output conservative.

MCP has two forms:

- `githits mcp start` always starts the stdio server and is skipped
- `githits mcp` starts stdio when stdin or stdout is non-TTY and is skipped
- interactive `githits mcp` shows setup instructions and remains eligible

## Implementation

Key modules:

| File | Purpose |
|---|---|
| `src/services/update-check-service.ts` | Registry fetch, cache handling, eligibility helpers, notice formatting |
| `src/cli/update-check.ts` | Cancellable background tasks, post-command advisory notice, cached required-update enforcement |
| `src/cli.ts` | Starts and flushes the update-check task around Commander parsing |
| `src/services/update-check-service.test.ts` | Service and eligibility coverage |
| `src/cli/update-check.test.ts` | CLI orchestration coverage |

The service accepts injected dependencies for the current version, fetcher,
clock, and file-system service. Tests should mock those dependencies rather than
patch global state.

The CLI injects the proxy-aware fetcher from `src/services/proxy-fetch.ts`, so
the direct npm registry calls honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`
without requiring package-manager configuration.

## Backend Compatibility Signals

All backend requests already include `x-githits-client-version` and a
`User-Agent`, so backend telemetry can identify old clients. Until the backend
has a structured `CLIENT_UPDATE_REQUIRED` error, the CLI maps GraphQL schema
validation failures such as `Cannot query field` to an `UPDATE_REQUIRED` error
because they are strong evidence that the client query is incompatible with the
backend schema.

## Future Work

Future phases can add:

- CDN-hosted version policy with `recommended` and `minimumSupported`
- recurring checks for long-running MCP servers
- `githits update`
- backend `426 Upgrade Required` enforcement
- structured GraphQL `CLIENT_UPDATE_REQUIRED` extensions with minimum version
  and upgrade instructions
