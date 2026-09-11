# Changelog

All notable GitHits CLI and public package changes are recorded here. Unreleased
changes use independent files under [`changes/`](changes/README.md) and are
consolidated here only during release preparation. Dated, versioned sections
are historical records and change only to correct blatant factual errors.

## [githits 0.16.2] - 2026-09-11

### Changed

- **Compact wait guidance** - Move repeated MCP wait and indexing-recovery guidance into the shared `quick_start` and `githits-mcp` skill, and shorten wait parameter descriptions to units and bounds derived from shared constants. The next CLI and MCP releases carry the updated guidance.
- **Longer default indexing wait** - Increase the shared CLI and MCP search, search-status, and code-navigation wait from 20 to 30 seconds to allow more time for indexing and metadata fetches before returning progress. Explicit wait overrides and the 60-second maximum remain unchanged.
- **Read exact documentation sections and ranges** - Search now emits indexed fragments as ready-to-read targets, while `docs read` and `docs_read` resolve them without synthetic bounds, preserve absolute page coordinates, and keep unresolved sections distinct from missing pages; deploy the compatible backend schema before releasing this client.
- **Ask follow-up scope** - Explain how to change project, version, or topic in an existing thread and keep the thread when clarifying a failed lookup.
- **Prefer token-efficient MCP text output** - Keep model-visible results in text and reserve JSON for direct host-side field handling or fields absent from text, not ordinary MCP or TypeScript invocation.

### Fixed

- **Search path-prefix validation** - Reject path prefixes locally when no code search source is selected, and correct CLI/MCP guidance to explain that documentation and symbol searches do not support this filter.
- **Ask guidance** - Remove the instruction to report defects using an Ask run ID because no such reporting action is available.
- **Local evaluation cleanup** - Wait for both target preflights before returning a setup failure, preventing Windows cleanup from racing an outstanding Git subprocess.

## [@githits/mcp 0.16.2] - 2026-09-11

### Changed

- **Compact wait guidance** - Move repeated MCP wait and indexing-recovery guidance into the shared `quick_start` and `githits-mcp` skill, and shorten wait parameter descriptions to units and bounds derived from shared constants. The next CLI and MCP releases carry the updated guidance.
- **Longer default indexing wait** - Increase the shared CLI and MCP search, search-status, and code-navigation wait from 20 to 30 seconds to allow more time for indexing and metadata fetches before returning progress. Explicit wait overrides and the 60-second maximum remain unchanged.
- **Read exact documentation sections and ranges** - Search now emits indexed fragments as ready-to-read targets, while `docs read` and `docs_read` resolve them without synthetic bounds, preserve absolute page coordinates, and keep unresolved sections distinct from missing pages; deploy the compatible backend schema before releasing this client.
- **Ask follow-up scope** - Explain how to change project, version, or topic in an existing thread and keep the thread when clarifying a failed lookup.
- **Prefer token-efficient MCP text output** - Keep model-visible results in text and reserve JSON for direct host-side field handling or fields absent from text, not ordinary MCP or TypeScript invocation.

### Fixed

- **Search path-prefix validation** - Reject path prefixes locally when no code search source is selected, and correct CLI/MCP guidance to explain that documentation and symbol searches do not support this filter.
- **Ask guidance** - Remove the instruction to report defects using an Ask run ID because no such reporting action is available.

## [githits 0.16.1] - 2026-09-10

Patch release: routes agents through a smaller self-contained MCP guide and
accepts oversized grep context requests by clamping them to the supported range.

### Added

- **Reproducible agent context measurements** - Add offline content
  inventory/replay, request-usage extraction, a production-schema fixture
  server, and documented Codex/Claude discovery and routing-format experiments
  without changing published guidance or runtime behavior.
- **Skill-bearing PR eval coverage** - Include the existing full-guidance
  scenario in agent-eval CI and Braintrust exports so canonical MCP skill
  changes are measured alongside descriptor-only scenarios.

### Changed

- **Routing guidance before tool discovery** - Make the self-contained MCP
  skill and quick-start guide lead with question-to-tool routing, defer argument
  details to the selected tool, and preserve public-source scope, citations, and
  untrusted-content rules.

### Fixed

- **Grep oversized context without a retry** - Clamp nonnegative integer context
  requests to 10 lines per side, preserve asymmetric overrides, and return
  requested/effective values in JSON with an actionable text notice. Direct
  larger source windows to `code_read` instead of repeating grep.

Hosted MCP users receive the routing and grep changes after the remote server
adopts `@githits/mcp@0.16.1` and deploys.

## [@githits/mcp 0.16.1] - 2026-09-10

Patch release: improves evidence-tool routing and handles oversized grep context
requests without requiring a retry.

### Changed

- **Routing guidance before tool discovery** - Make the self-contained MCP
  skill and quick-start guide lead with question-to-tool routing, defer argument
  details to the selected tool, and preserve public-source scope, citations, and
  untrusted-content rules.

### Fixed

- **Grep oversized context without a retry** - Clamp nonnegative integer context
  requests to 10 lines per side, preserve asymmetric overrides, and return
  requested/effective values in JSON with an actionable text notice. Direct
  larger source windows to `code_read` instead of repeating grep.

Hosted clients receive these changes after the remote server adopts
`@githits/mcp@0.16.1` and deploys.

## [githits 0.16.0] - 2026-09-10

Minor release: removes feedback (breaking change) and marks all remaining MCP
information tools read-only. Packaged skills match the smaller tool catalog.

### Changed

- **Read-only information tools** - All remaining MCP tools advertise
  `readOnlyHint: true`, including local experimental Ask. Internal result
  storage, preparation, and research-thread behavior remain unchanged.

### Removed

- **Feedback submission** - Remove the MCP `feedback` tool and `githits feedback`
  command. Remove feedback instructions; existing
  `experimental.report_tool_issues` config keys are ignored. Remove feedback
  calls from integrations and refresh MCP tool discovery after updating.

### Fixed

- **Actionable Ask target errors** - CLI and local MCP Ask preserve validated
  server diagnostics and recovery guidance, including unfamiliar diagnostic
  codes and reasons. Diagnostic codes and reasons can evolve without a client
  update. Legacy or malformed responses receive actionable fallback text.
- **Public skill guidance** - Remove CLI feedback recommendations and the
  onboarding feedback disclosure. Onboarding and recovery preserve the requested
  CLI version, project scope, guidance preference, and separate Cursor
  authentication. This release packages the skill cleanup already merged to main.

Hosted MCP users, including plugins and direct Cursor setup, receive the tool
annotation and feedback changes after the remote server adopts the new MCP
package and deploys.

## [@githits/mcp 0.16.0] - 2026-09-10

Minor release: removes the feedback tool and service API (breaking change).

### Changed

- **Read-only information tools** - All remaining tools advertise
  `readOnlyHint: true`. The public `runMcpSmoke()` helper requires this annotation
  on every advertised tool and rejects catalogs that retain feedback. Internal
  result storage and preparation retain their existing behavior.

### Removed

- **Feedback submission** - Remove the MCP `feedback` tool and `submitFeedback`
  from the public service interface and concrete clients. Remove feedback
  instructions. Consumers must remove calls to the retired API/tool and refresh
  MCP tool discovery after updating.

Hosted clients receive these changes after the remote server adopts
`@githits/mcp@0.16.0` and deploys.

## [githits 0.15.1] - 2026-09-08

Patch release: aligns Ask target clarification across CLI and local MCP and
preserves documentation indexing state.

### Fixed

- **Ask target clarification** - Display resolver candidates with confidence,
  related targets, and evidence metadata when Ask requests a specific target.
  Question-only asks work in both the CLI and local MCP. Requires server support;
  answered responses and explicit-target behavior remain unchanged.
- **Documentation indexing state** - `docs list` distinguishes active
  preparation from terminal empty results and retains provisional pages with
  exact lifecycle state in JSON.

## [@githits/mcp 0.15.1] - 2026-09-08

Patch release: preserves documentation indexing state.

### Fixed

- **Documentation indexing state** - `docs_list` distinguishes active
  preparation from terminal empty results and retains provisional pages with
  exact lifecycle state in JSON.

Hosted MCP users receive applicable changes after the service rollout.

## [githits 0.15.0] - 2026-09-08

Minor release: adds Codeberg and nested GitLab repository targets and lets
experimental CLI Ask infer a target from a question.

### Added

- **Multi-provider repository targets** - Add explicit `codeberg:owner/repo` and
  nested `gitlab:group/subgroup/project` targets alongside GitHub across search
  and code navigation. Preserve provider identity and exact refs in follow-ups,
  GitHub shorthand/HTTP compatibility, and registry-native Swift/Zig coordinates.
  Bare repository names and unsupported hosts are rejected. Public code, MCP,
  and package guidance now describe the supported target forms.
- **Question-only Ask** - Experimental CLI `githits ask "question"` lets GitHits
  identify a public package or repository from the question. Explicit targets
  and thread follow-ups remain supported.

### Fixed

- **Code navigation authentication** - Recognize backend
  `AUTHENTICATION_REQUIRED` errors and attempt the existing single credential
  refresh, matching package-intelligence behavior while preserving access-denied
  errors.
- **Rejected refresh credentials** - Recognize OAuth and Supabase refresh-token
  and session rejection codes without relying on description wording, clearing
  unchanged rejected tokens while preserving client registration and credentials
  replaced during refresh.
- **On-demand site documentation** - Resolution describes site documentation
  needing preparation as crawled on demand while preserving ordinary on-demand
  search continuation, identity, ordering, and security checks.
- **Release availability checks** - Both npm release pipelines wait for the exact
  package version to become public before downstream publication, and recover
  accepted uploads still undergoing npm scanning when a release job is rerun.

## [@githits/mcp 0.15.0] - 2026-09-08

Minor release: adds Codeberg and nested GitLab repository targets.

### Added

- **Multi-provider repository targets** - Add explicit `codeberg:owner/repo` and
  nested `gitlab:group/subgroup/project` targets alongside GitHub across search
  and code navigation. Preserve provider identity and exact refs in follow-ups,
  GitHub shorthand/HTTP compatibility, and registry-native Swift/Zig coordinates.
  Bare repository names and unsupported hosts are rejected. MCP guidance and
  contextual tool help describe the supported target forms.

### Fixed

- **Code navigation authentication** - Recognize backend
  `AUTHENTICATION_REQUIRED` errors and use the existing authentication handling
  path while preserving access-denied errors.
- **On-demand site documentation** - Resolution describes site documentation
  needing preparation as crawled on demand while preserving ordinary on-demand
  search continuation, identity, ordering, and security checks.

Hosted MCP clients receive these changes after remote-mcp updates this package
and deploys the hosted server.

## [githits 0.14.0] - 2026-09-07

Minor release: changes default search text to authoritative match evidence and
adds opt-in resolved-dependency vulnerability audits and dependency registries.

### Added

- **Expand dependency registry support** - CLI `pkg deps` and MCP `pkg_deps` now accept
  NuGet, Maven, and Packagist alongside the other deployed dependency registries.
- **Discovery match evidence** - Search JSON adds indexed-field provenance,
  authoritative matched source, and crawled-documentation previews. Default search text
  renders path-only matches as compact file headers instead of arbitrary source chunks,
  shows proven source snippets, and uses structural documentation previews. Requires the
  deployed additive v31 producer schema.
- **Audit resolved dependency vulnerabilities** - Add opt-in transitive vulnerability
  evidence to `pkg vulns` and `pkg_vulns` while preserving direct-only defaults and
  applying advisory scope consistently to root and dependency rows.

### Changed

- **Complete CLI vulnerability rows** - CLI compact text now shows every selected direct
  and transitive advisory row; verbose mode adds clearer transitive evidence and JSON
  preserves advisory-wide affected-range and fixed-version fields.

### Fixed

- **Agent eval isolation validation** - Stop treating `rg --files` guidance filename
  globs as guidance content reads, while retaining checks for actual reads in the same
  command.

### Security

- **Sanitize vulnerability terminal text** - Strip hostile terminal control sequences
  from vulnerability display values while preserving lossless JSON evidence.

## [@githits/mcp 0.14.0] - 2026-09-07

Minor release: changes default search text to authoritative match evidence and
adds opt-in resolved-dependency vulnerability audits and dependency registries.

### Added

- **Expand dependency registry support** - `pkg_deps` now accepts NuGet, Maven, and
  Packagist alongside the other deployed dependency registries.
- **Discovery match evidence** - Search JSON adds indexed-field provenance,
  authoritative matched source, and crawled-documentation previews. Default search text
  renders path-only matches as compact file headers instead of arbitrary source chunks,
  shows proven source snippets, and uses structural documentation previews. Requires the
  deployed additive v31 producer schema.
- **Audit resolved dependency vulnerabilities** - Add opt-in transitive vulnerability
  evidence to `pkg vulns` and `pkg_vulns` while preserving direct-only defaults and
  applying advisory scope consistently to root and dependency rows.

### Changed

- **Detailed vulnerability evidence** - Verbose text adds clearer transitive evidence
  and JSON preserves advisory-wide affected-range and fixed-version fields. Compact MCP
  text remains capped; use verbose mode for all selected advisory rows.

### Security

- **Sanitize vulnerability terminal text** - Strip hostile terminal control sequences
  from vulnerability display values while preserving lossless JSON evidence.

Hosted MCP clients receive these changes after remote-mcp updates this package
and deploys the hosted server.

## [githits 0.13.0] - 2026-09-07

Minor release: adds semantic search context and documentation read targets,
simplifies MCP output formats, and replaces legacy `->` upgrade ranges with `..`.

### Added

- **Semantic search context** - Search and search-status show enclosing declarations and
  numbered focused source, with precise attributed read coordinates and additive
  structural evidence in JSON. Requires the backend structural-evidence schema; hosted
  MCP adoption also requires updating and deploying remote-mcp after the package
  release.

### Changed

- **Upgrade-review range syntax** - Accept positional `..` ranges, including scoped
  packages, and remove the legacy `->` delimiter; use `..` for all compact ranges.
- **Read documentation through emitted targets** - Docs list and search now
  retain `docsReadTarget`, stable `pageId`, and provenance `sourceUrl`, prefer
  clickable URL targets in follow-ups, and keep historical ID reads compatible.
- **MCP output formats** - All format-selectable tools now expose only `text` (default)
  and `json`, with guidance to reserve JSON for programmatic follow-up or exact
  structured details. Explicit `text-v1` callers must switch to `text` or omit the
  format parameter; rendering and JSON payloads are unchanged.
- **Text follow-up guidance** - Tool format descriptions, quick_start, and the GitHits
  MCP skill explicitly recommend text for reading and subsequent tool calls, reserving
  JSON for parsing in code or required fields absent from text.

### Fixed

- **Go version compatibility (already shipped in CLI 0.12.1)** - Package
  documentation, dependency, vulnerability, changelog, and upgrade-review inputs
  accept exact Go versions with or without `v` and send the canonical
  `v`-prefixed form. This records the previously omitted CLI release note;
  the matching MCP fix first ships in 0.13.0.

## [@githits/mcp 0.13.0] - 2026-09-07

Minor release: adds semantic search context, documentation read targets, and
simplifies MCP output formats.

### Added

- **Semantic search context** - Search and search-status show enclosing declarations and
  numbered focused source, with precise attributed read coordinates and additive
  structural evidence in JSON. Requires the backend structural-evidence schema; hosted
  MCP adoption also requires updating and deploying remote-mcp after the package
  release.

### Changed

- **Read documentation through emitted targets** - Docs list and search now
  retain `docsReadTarget`, stable `pageId`, and provenance `sourceUrl`, prefer
  clickable URL targets in follow-ups, and keep historical ID reads compatible.
- **MCP output formats** - All format-selectable tools now expose only `text` (default)
  and `json`, with guidance to reserve JSON for programmatic follow-up or exact
  structured details. Explicit `text-v1` callers must switch to `text` or omit the
  format parameter; rendering and JSON payloads are unchanged.
- **Text follow-up guidance** - Tool format descriptions, quick_start, and the GitHits
  MCP skill explicitly recommend text for reading and subsequent tool calls, reserving
  JSON for parsing in code or required fields absent from text.

### Fixed

- **Accept canonical Go module versions** - Package documentation, dependency,
  vulnerability, changelog, and upgrade-review inputs now accept exact Go
  versions with or without `v` and send the backend the canonical `v`-prefixed
  form.

## [githits 0.12.1] - 2026-09-04

Patch release: adds opt-in dependency issue analysis and expanded package
overview evidence, and improves GitHits skill discovery.

### Added

- **Dependency issue analysis** - Opt into deprecated, outdated, duplicate, and
  conflict analysis with `pkg deps --issues` or MCP `include_issues: true`,
  including actionable conflict constraints and importer provenance in text and
  JSON.
- **Clarify package overview evidence** - `pkg_info` separates latest-version
  affected vulnerabilities from package-wide advisory history, keeps that
  summary evidence-only, improves URL contrast, and exposes published-version
  count plus download freshness in verbose text and JSON. Full-history routing
  remains available in CLI help and the MCP descriptor.

### Fixed

- **Improve GitHits skill discovery** - Make the MCP skill describe the OSS and
  package tasks that should trigger it instead of assuming GitHits was already
  selected.

## [@githits/mcp 0.12.1] - 2026-09-04

Coordinated patch release: adds opt-in dependency issue analysis and expanded
package overview evidence.

### Added

- **Dependency issue analysis** - Opt into deprecated, outdated, duplicate, and
  conflict analysis with MCP `include_issues: true`, including actionable
  conflict constraints and importer provenance in text and JSON.
- **Clarify package overview evidence** - `pkg_info` separates latest-version
  affected vulnerabilities from package-wide advisory history, keeps that
  summary evidence-only, improves URL contrast, and exposes published-version
  count plus download freshness in verbose text and JSON. Full-history routing
  remains available in the MCP descriptor.

## [githits 0.12.0] - 2026-09-03

Minor release: adds opt-in Agentic Ask and improves repository grep,
upgrade-review validation and release context, and Windows token-refresh
handoff.

### Added

- **Experimental Agentic Ask** - Add opt-in `githits ask` CLI and local MCP
  surfaces with source-cited answers, follow-up threads, directly executable
  source calls, and original upstream URL sources.

### Changed

- **Align upgrade-review batch validation** - CLI and MCP now advertise and
  enforce the deployed limit of 30 nonblank package upgrades before sending a
  request.

### Fixed

- **Align grep symbol fields** - CLI and MCP validation now expose only symbol
  metadata that repository grep can hydrate.
- **Improve upgrade-review release context** - Compact output keeps
  identity-only sampled releases visible and avoids repeating releases across
  heuristic, sampled, and verbose entries.
- **Serialize Windows token refresh handoff** - Release file-backed auth locks
  without racing successor agents against removal of the shared lock path.

## [@githits/mcp 0.12.0] - 2026-09-03

Coordinated minor release: aligns `@githits/mcp` with the CLI 0.12 line and
improves repository grep and upgrade-review validation and release context.

### Changed

- **Align upgrade-review batch validation** - CLI and MCP now advertise and
  enforce the deployed limit of 30 nonblank package upgrades before sending a
  request.

### Fixed

- **Align grep symbol fields** - CLI and MCP validation now expose only symbol
  metadata that repository grep can hydrate.
- **Improve upgrade-review release context** - Compact output keeps
  identity-only sampled releases visible and avoids repeating releases across
  heuristic, sampled, and verbose entries.

## [githits 0.11.5] - 2026-09-02

Coordinated patch release: improves quick-start discovery and public OSS
content safety, fixes Agent Skill discovery and packaging, and expands
maintainer eval coverage.

### Changed

- **Temporarily evaluate every main update** - Run the advisory Luna agent-eval
  workflow on every push to `main` while maintainers collect Braintrust
  variance and workload-optimization evidence; daily, manual, and explicitly
  labeled pull-request runs remain available.

### Fixed

- **Hide the Braintrust eval skill from public installers** - Mark the
  repository-only operations skill as internal so skill registries do not
  offer it to end users.
- **Improve quick-start discovery** - The `quick_start` catalog sentence now
  identifies the required first call and the untrusted-content safety rules it
  loads before plain MCP sessions use evidence tools.
- **Keep the MCP skill installable** - Quote its YAML frontmatter description
  so standards-compliant Agent Skill installers parse it successfully.

### Security

- **Clarify remote OSS content boundaries** - Frame retrieved public OSS
  content as untrusted evidence that cannot override user authorization or
  host safeguards while preserving prompt-injection protections.

## [@githits/mcp 0.11.5] - 2026-09-02

Coordinated patch release: improves quick-start discovery and clarifies the
security boundaries for retrieved public OSS content.

### Fixed

- **Improve quick-start discovery** - The `quick_start` catalog sentence now
  identifies the required first call and the untrusted-content safety rules it
  loads before plain MCP sessions use evidence tools.

### Security

- **Clarify remote OSS content boundaries** - Frame retrieved public OSS
  content as untrusted evidence that cannot override user authorization or
  host safeguards while preserving prompt-injection protections.

## [githits 0.11.4] - 2026-09-01

Patch release: adds definition-aware search evidence, improves MCP session
guidance and wrapped source readability, and expands maintainer-facing
Braintrust eval persistence.

### Added

- **Definition-aware search evidence** - CLI and MCP search results now
  preserve focused, indexed, and symbol-definition ranges, lead with focused
  evidence while annotating qualified enclosing symbols, and generate exact
  served-revision repository follow-ups. The deployed Phase 1A GraphQL schema
  is required.

### Changed

- **Braintrust agent-eval persistence** - Add maintainer-facing normalized eval
  export with stable channel-aware experiment names, explicit latest-main
  baseline linkage, harness-observed tool lifecycle timing, and native
  structural Braintrust tool spans. The exporter records source, channel,
  branch, pull request, and commit identity and reports the actual linked base
  experiment; the first main run remains a one-time bootstrap, and pull-request
  or default local exports fail before that baseline exists. This does not
  change public package behavior.

### Fixed

- **Make MCP session guidance reliable** - MCP servers built from `githits` or
  `@githits/mcp` now require one `quick_start` call per plain session while
  agents with the loaded `githits-mcp` skill skip it for every tool. GitHits
  MCP and CLI skills now use transport-specific triggers so agents load only
  the matching workflow.
- **Readable wrapped source comments** - Compact search output now repeats
  source comment markers on wrapped continuation lines instead of making
  comment text look like executable code.

## [@githits/mcp 0.11.4] - 2026-09-01

Coordinated patch release: adds definition-aware search evidence and improves
MCP session guidance and wrapped source readability.

### Added

- **Definition-aware search evidence** - CLI and MCP search results now
  preserve focused, indexed, and symbol-definition ranges, lead with focused
  evidence while annotating qualified enclosing symbols, and generate exact
  served-revision repository follow-ups. The deployed Phase 1A GraphQL schema
  is required.

### Fixed

- **Make MCP session guidance reliable** - MCP servers built from `githits` or
  `@githits/mcp` now require one `quick_start` call per plain session while
  agents with the loaded `githits-mcp` skill skip it for every tool. GitHits
  MCP and CLI skills now use transport-specific triggers so agents load only
  the matching workflow.
- **Readable wrapped source comments** - Compact search output now repeats
  source comment markers on wrapped continuation lines instead of making
  comment text look like executable code.

## [githits 0.11.3] - 2026-08-31

Patch release: improves search, target-resolution, and upgrade-review output;
preserves actionable authentication, version, provenance, and keychain errors;
and expands local agent-evaluation tooling.

### Added

- **Local Luna eval suites** - Provide repository-local Luna named-suite,
  paired, and offline comparison tooling with explicit discovery/intent/full
  scenario cells, schema-v2 suite/comparison artifacts, scenario-aware cohorts,
  and deterministic schema-v1 compatibility. Defaults keep canary
  discovery+intent and other named suites intent-only; full is local/manual
  opt-in. Service export remains unimplemented, and artifacts distinguish tool
  execution from answer-quality evidence.

### Changed

- **Group resolved project identities** - CLI and local MCP resolution now keep
  related package, repository, and documentation targets together with compact
  per-target metric lanes, licenses, security warnings, and relation truncation
  visible.
- **Grouped upgrade review output** - CLI and MCP now share compact,
  outcome-first upgrade evidence text with restrained semantic terminal color
  while preserving follow-up locators and structured JSON.
- **Route broad vulnerability questions to current evidence** - `pkg_vulns`
  now explicitly covers qualitative package security questions and directs
  agents away from potentially outdated training data.
- **Explain target-resolution evidence** - `githits resolve` and its local
  experimental MCP counterpart expose backend name similarity in JSON and
  opt-in verbose text, qualify it as coarse lexical support without reranking,
  and label positive code evidence as an indexed package or repository
  snapshot. Default text remains compact, uses a neutral target heading, omits
  negative availability claims, and does not fetch lexical evidence.
  Experimental JSON candidates no longer project backend ranking `reason`
  text.
- **Agent eval isolation** - Codex evals and interactive sessions now use
  disposable acting-agent home/config/temp roots, validate an absolute
  dedicated `CODEX_HOME` before use or launch, reject direct home skills other
  than `.system`, preserve trusted host auth roots only for the local GitHits
  MCP child, and persist safe relative isolation metadata. Interactive sessions
  omit exec-only flags and enforce the dedicated-home skills/config contract.
- **Agent eval scenario metrics** - Maintainer-facing local eval runs now emit
  schema-v2 normalized usage, cost, tool-surface, scenario, intent, and agent
  version metrics. Exact intent fragments are SHA-256 identified, neutral
  intent records `null`, valid schema-v1 metrics normalize deterministically,
  and same-agent comparisons warn on version drift.
- **Daily Luna agent eval workflow** - Add maintainer-authorized daily, manual,
  and same-repository labeled-pull-request execution for the Luna discovery and
  intent suites, bounded concurrency, 14-day raw artifact retention, and
  concise absolute summaries. Public package behavior is unchanged.

### Fixed

- **Search recovery and target guidance** - Correct terminal target recovery
  and canonical package addressing, and unify CLI/MCP text around compact
  target-state output with inline recovery and concrete documentation
  provenance.
- **Recognize backend authentication-required errors** - Package/source tools
  now refresh or return the standard authentication guidance when GraphQL uses
  its documented `AUTHENTICATION_REQUIRED` code.
- **Preserve CodeDiff version alternatives** - Keep backend-ranked package
  versions and their proven source refs in CLI/MCP error details, and show
  actionable alternatives in CLI text.
- **Surface keychain access failures** - Update `@napi-rs/keyring` so
  unavailable or inaccessible credential stores report an error instead of
  appearing to contain no credentials.

## [@githits/mcp 0.11.3] - 2026-08-31

Coordinated patch release: improves shared search and upgrade-review output,
tool routing, authentication guidance, and CodeDiff recovery evidence.

### Changed

- **Grouped upgrade review output** - CLI and MCP now share compact,
  outcome-first upgrade evidence text while preserving follow-up locators and
  structured JSON.
- **Route broad vulnerability questions to current evidence** - `pkg_vulns`
  now explicitly covers qualitative package security questions and directs
  agents away from potentially outdated training data.

### Fixed

- **Search recovery and target guidance** - Correct terminal target recovery
  and canonical package addressing, and unify CLI/MCP text around compact
  target-state output with inline recovery and concrete documentation
  provenance.
- **Recognize backend authentication-required errors** - Package/source tools
  now refresh or return the standard authentication guidance when GraphQL uses
  its documented `AUTHENTICATION_REQUIRED` code.
- **Preserve CodeDiff version alternatives** - Keep backend-ranked package
  versions and their proven source refs in CLI/MCP error details so callers can
  offer actionable alternatives.

## [githits 0.11.2] - 2026-08-28

Patch release: unifies search output across CLI and MCP, recognizes standalone
documentation sites during target resolution, recovers init sign-in after
stale refresh failures, and makes the packaged MCP skill self-contained.

### Changed

- **Agent eval metrics** - Maintainer-facing local eval runs now persist
  normalized usage, cost, tool-surface, and report metrics; public package
  artifacts are unchanged.
- **Keep MCP release lockfiles aligned** - Coordinated release preparation now
  updates the `@githits/mcp` workspace version in `bun.lock` alongside the
  package manifest so later dependency changes do not inherit release-only
  lockfile churn.
- **Clarify unified search output** - Add exact partial-result truth to JSON and
  route `githits` and `@githits/mcp` search/search-status through one
  outcome-first formatter with compact completed-result headlines, numbered
  locator-first human hits that retain docs page IDs for `docs_read`, ASCII
  formatter-authored punctuation, source provenance, target-grouped readiness
  when trust facts require it, terminal-aware CLI wrapping, concise
  session/action rows, bounded provenance, ANSI hierarchy, and surface-native
  continuation guidance while preserving Unicode backend payload text.
- **Recognize standalone-site resolve candidates** - `resolve` labels backend
  site candidates as `site` instead of the unknown-kind `target` fallback, and
  a `site` preferred kind is accepted by both the CLI `--prefer-kind` option
  and the experimental `resolve_target` tool. Experimental CLI/MCP guidance
  advertises site resolution and routes selected site targets into docs search.
  Stable MCP guidance now distinguishes package-only `docs_list` from the
  standalone-site search and `docs_read` flow.

### Fixed

- **Recover init sign-in after stale refresh failures** - Interactive init now
  proceeds to browser OAuth when retained expired credentials cannot refresh,
  and its runnable authentication guidance consistently uses
  `npx githits@latest`.
- **Self-contained MCP skill** - The loaded `githits-mcp` skill now includes the
  stable quick-start guidance without a redundant bootstrap call, while plain
  MCP clients retain the `quick_start` fallback.

## [@githits/mcp 0.11.2] - 2026-08-28

Coordinated patch release: unifies search output and recognizes standalone
documentation sites during target resolution.

### Changed

- **Clarify unified search output** - Add exact partial-result truth to JSON and
  route `githits` and `@githits/mcp` search/search-status through one
  outcome-first formatter with compact completed-result headlines, numbered
  locator-first human hits that retain docs page IDs for `docs_read`, ASCII
  formatter-authored punctuation, source provenance, target-grouped readiness
  when trust facts require it, terminal-aware CLI wrapping, concise
  session/action rows, bounded provenance, ANSI hierarchy, and surface-native
  continuation guidance while preserving Unicode backend payload text.
- **Recognize standalone-site resolve candidates** - `resolve` labels backend
  site candidates as `site` instead of the unknown-kind `target` fallback, and
  a `site` preferred kind is accepted by both the CLI `--prefer-kind` option
  and the experimental `resolve_target` tool. Experimental CLI/MCP guidance
  advertises site resolution and routes selected site targets into docs search.
  Stable MCP guidance now distinguishes package-only `docs_list` from the
  standalone-site search and `docs_read` flow.

## [githits 0.11.1] - 2026-08-27

Patch release: reduces agent context round trips, improves package-tool
selection, and makes selected uninstall cleanup and diagnostics ownership more
predictable.

### Changed

- **Reduce agent context round trips** - Allow deliberate 300-line source and
  documentation reads while keeping 150-line defaults, align grep per-file
  limits with requested totals, clarify served indexing snapshots, and improve
  public-repository discovery and source safety guidance.
- **Clarify packaged ownership guidance** - Agent guidance now assigns
  diagnostics lifecycle and output destinations to the CLI host while core and
  MCP remain host-neutral; MCP error classifiers no longer emit CLI debug
  lines, while core service diagnostics can still emit when the CLI container
  injects them.
- **Improve package-tool selection** - Package MCP descriptions now lead with
  compact user-intent phrases so truncated tool catalogs distinguish health,
  vulnerability, dependency, changelog, and upgrade questions.

### Fixed

- **Respect uninstall selection for guidance** - Interactive user uninstall
  now removes guidance only for selected tools whose MCP is absent after
  cleanup and preserves shared guidance usable by any detected tool that was
  kept.

## [@githits/mcp 0.11.1] - 2026-08-27

Coordinated patch release: adds the browser-callable tool entry, propagates
host execution context, reduces agent context round trips, and tightens the
public client boundary.

### Added

- **Add browser-callable tools entry** - `@githits/mcp/tools` exposes the
  validated `get_example` callable surface for frontend WebMCP integration;
  only this selected runtime graph is browser-safe, while the installed package
  and other entries remain Node-oriented.

### Changed

- **Reduce agent context round trips** - Allow deliberate 300-line source and
  documentation reads while keeping 150-line defaults, align grep per-file
  limits with requested totals, clarify served indexing snapshots, and improve
  public-repository discovery and source safety guidance.
- **Add host-aware terms remediation and cancellation** - Hosted and
  browser-callable defaults now use canonical acceptance-URL guidance, while
  local CLI and stdio hosts preserve the CLI command override; explicit caller
  cancellation propagates through execution context so trace hooks observe
  rejection and cancelled work cannot refresh or retry.
- **Improve package-tool selection** - Package MCP descriptions now lead with
  compact user-intent phrases so truncated tool catalogs distinguish health,
  vulnerability, dependency, changelog, and upgrade questions.

### Removed

- **Remove client telemetry lifecycle globals** - The pre-1.0
  `@githits/mcp/client` telemetry lifecycle exports are removed; remote hosts
  inject `ServiceDiagnostics` when they need operation or debug diagnostics.

## [githits 0.11.0] - 2026-08-26

Minor release: adds portable MCP quick-start guidance, makes onboarding setup
and removal predictable, and tightens local request validation and changelog
range semantics.

### Changed

- **Improve remote MCP tool routing** - Make tool catalogs benefit-first with
  explicit workflow handoffs, replace inconsistently surfaced server
  instructions with a one-call `quick_start` guide, and compact the packaged
  Agent Skill to point at that guide. Deploy the hosted endpoint with
  `@githits/mcp` 0.11.0 before relying on `quick_start` from remote plugins and
  extensions.

### Fixed

- **Make onboarding setup and removal predictable** - `init` now targets
  selected agents and repairs all packaged guidance with transport-aware
  readiness output; the canonical `githits uninstall` command removes GitHits
  setup while retaining the nested compatibility alias.
- **Correct changelog range semantics** - Document and expose `from` as an
  exclusive lower bound, so exact-release and range requests use the backend
  contract consistently. Returned entries preserve backend/source order;
  consumers must not assume newest-first ordering.
- **Reject canonical resolve inputs locally** - The opt-in experimental
  `githits resolve` command and local `resolve_target` tool now direct
  already-canonical package and GitHub repository targets to the next GitHits
  tool without calling the resolver backend.

## [@githits/mcp 0.11.0] - 2026-08-26

Coordinated minor release: adds portable one-call MCP guidance, improves tool
routing, and aligns changelog range semantics with the backend contract.

### Changed

- **Improve remote MCP tool routing** - Make tool catalogs benefit-first with
  explicit workflow handoffs and replace inconsistently surfaced default
  server instructions with a one-call `quick_start` guide. `createMcpServer()`
  now leaves initialize instructions caller-owned; use `quickStartOptions`
  instead of the deprecated `instructionOptions` to configure the guide.
  `buildMcpInstructions()` remains a deprecated alias for
  `buildMcpQuickStart()`, and the public smoke helper now requires and checks
  `quick_start` in the stable tool inventory.

### Fixed

- **Correct changelog range semantics** - Document and expose `from` as an
  exclusive lower bound, so exact-release and range requests use the backend
  contract consistently. Returned entries preserve backend/source order;
  consumers must not assume newest-first ordering.

## [githits 0.10.2] - 2026-08-25

Patch release: fine-tunes opt-in experimental target resolution for safer
partial-readiness handling and makes targeted init reliability improvements.

### Fixed

- **Reliable init install and uninstall** - Use structured Claude user MCP
  inspection and best-effort guidance cleanup so absent state is safe, failures
  remain visible, and guidance reporting stays separate from agent counts.

### Security

- **Fail closed on malicious package candidates** - The opt-in experimental
  resolver now preserves latest-version malicious-content decisions and bounded
  OSV evidence, links affected or uncertain advisories in warnings, and
  withholds normal CLI/MCP continuation for affected, unknown, or unrecognized
  states.

## [githits 0.10.1] - 2026-08-24

Patch release: hardens concurrent CLI authentication and preserves queryable
search evidence while indexing and backend session statuses evolve.

### Changed

- **Expose provisional search evidence** - Accept and render queryable
  `PROVISIONAL` repository and documentation freshness while preserving exact
  served identity, indexing guidance, hits, and `searchRef` continuation only
  for active sessions.

### Fixed

- **Reliable concurrent CLI authentication** - Preserve live per-user auth
  locks when process or lock-owner metadata inspection is temporarily
  unavailable, and serialize stale-owner cleanup so parallel local CLI and MCP
  processes cannot reuse rotating refresh tokens. Restart long-running local
  MCP processes after upgrading so every process uses the hardened lock
  protocol.
- **Evolving search-session statuses** - CLI search accepts terminal `DEFERRED`
  and future status values without discarding available evidence. Only known
  active sessions and explicit completed-result follow-ups direct callers to
  `search-status`; stopped or unknown sessions preserve current evidence and
  provide a new-search action without further polling.

## [@githits/mcp 0.10.1] - 2026-08-24

Patch release: preserves queryable search evidence while indexing and keeps
follow-up guidance aligned as backend session statuses evolve.

### Changed

- **Expose provisional search evidence** - Accept and render queryable
  `PROVISIONAL` repository and documentation freshness while preserving exact
  served identity, indexing guidance, hits, and `searchRef` continuation only
  for active sessions.

### Fixed

- **Evolving search-session statuses** - MCP search accepts terminal `DEFERRED`
  and future status values without discarding available evidence. Only known
  active sessions and explicit completed-result follow-ups direct agents to
  `search_status`; stopped or unknown sessions preserve current evidence and
  provide a new-search action without further polling.

## [githits 0.10.0] - 2026-08-19

Minor release: introduces opt-in local experimental tools for target resolution
and exact source diffs while keeping the default CLI, hosted MCP, plugins, and
extensions on the stable tool inventory.

### Added

- **Local experimental tools** - adds config-gated `resolve_target` and
  `code_diff` to the local stdio MCP server alongside the matching `githits
  resolve` and `githits code diff` commands. Enable the hidden-by-default suite
  with `[experimental] tools = true`; hosted MCP, plugins, extensions, and the
  public MCP API remain unchanged.
- **Documentation source evidence** - search and search-status now identify the
  repository and published-site documentation behind results. Healthy sources
  render as compact references, while stale, incomplete, pending, or unavailable
  sources explain what was searched and what the published evidence covers.

### Changed

- **Experimental CLI defaults** - `resolve` and `code diff` are hidden and
  disabled unless the experimental suite is enabled. Optional
  `report_tool_issues = "experimental"` or `"all"` adds redacted local agent
  feedback guidance without sending feedback automatically.
- **Authoritative documentation site identities** - discovery search and status
  now carry canonical docpack URLs and show their host and path even when no
  hits are returned.
- **Human release merge gate** - release preparation now stops at an open PR;
  merging requires separate explicit human approval after that PR exists.

### Fixed

- **Confident target resolution** - Resolve guidance now emits direct canonical
  next actions only for non-ambiguous exact or high-confidence matches; weaker
  and empty results require explicit correction or selection.
- **Repository-wide code diff guidance** - CLI help, legacy-scope diagnostics,
  and public client documentation now explain that package targets resolve
  repository and commit identity while raw diffs remain repository-wide and
  bounded results may contain only sibling paths.
- **Diff terminal output** - CodeDiff now aligns wide Unicode paths by terminal
  cell width and colors patches, stat bars, summary markers, and change statuses
  when supported; verbose code-file rows use the same alignment.

## [@githits/mcp 0.10.0] - 2026-08-19

Coordinated minor release: aligns the public MCP package with the CLI 0.10 line
while improving stable documentation-source and code-diff evidence. The
experimental `resolve_target` and `code_diff` tools remain local to `githits`
and are not exported by the public MCP server API.

### Added

- **Documentation source evidence** - search and search-status now identify the
  repository and published-site documentation behind results. Healthy sources
  render as compact references, while stale, incomplete, pending, or unavailable
  sources explain what was searched and what the published evidence covers.

### Changed

- **Authoritative documentation site identities** - discovery search and status
  now carry canonical docpack URLs and show their host and path even when no
  hits are returned.

### Fixed

- **Repository-wide code diff guidance** - public client documentation now
  explains that package targets resolve repository and commit identity while
  raw diffs remain repository-wide and bounded results may contain only sibling
  paths.

## [githits 0.9.3] - 2026-08-18

Patch release: adds an unpromoted CodeDiff CLI dogfood surface and improves
CLI recovery, validation guidance, and search diagnostics.

### Added

- **Silent CodeDiff CLI dogfooding** - adds `githits code diff` with bounded
  Git-like views, repository-relative glob filtering, reversible path quoting,
  apply-safe patch handling, structured completeness diagnostics, and JSON
  output without exposing an MCP tool or agent guidance yet.

### Changed

- **Independent changelog fragments** - notable changes now record release
  notes and per-artifact SemVer impact in independently owned files, avoiding
  conflicts in `CHANGELOG.md` during normal development.

### Fixed

- **Code validation guidance** - client-side `INVALID_ARGUMENT` errors from
  shared code-read and grep request builders now name CLI commands,
  positionals, and options on the CLI while MCP keeps MCP-native tool and
  argument syntax.
- **Remove obsolete ref suggestions** - waited searches no longer recommend an
  older ref after reaching the requested commit.
- **Explain unavailable exact paths** - CLI and MCP now return
  `FILE_PATH_EXCLUDED` for excluded files and
  `SOURCE_FILE_INVENTORY_UNKNOWN` when the index cannot verify a path, with
  actionable path and resolution details.
- **Standalone-site search recovery** - CLI and MCP search now preserve ordered
  backend site suggestions, distinguish truncated candidate lists, and direct
  active crawls through search status without guessing or rewriting targets.
  Help text also distinguishes atomic interim evidence from opted-in partial
  target/source subsets.

## [@githits/mcp 0.9.2] - 2026-08-18

Patch release: adds an opt-in CodeDiff client capability and improves search
and exact-path recovery without exposing a new remote MCP tool.

### Added

- **CodeDiff client support** - adds the transport-neutral package and
  repository diff adapter as an additive `CodeDiffService` capability without
  exposing a remote MCP tool.

### Fixed

- **Remove obsolete ref suggestions** - waited searches no longer recommend an
  older ref after reaching the requested commit.
- **Explain unavailable exact paths** - MCP tools now return
  `FILE_PATH_EXCLUDED` for excluded files and
  `SOURCE_FILE_INVENTORY_UNKNOWN` when the index cannot verify a path, with
  actionable path and resolution details.
- **Standalone-site search recovery** - MCP search now preserves ordered
  backend site suggestions, distinguishes truncated candidate lists, and
  directs active crawls through search status without guessing or rewriting
  targets. Help text also distinguishes atomic interim evidence from opted-in
  partial target/source subsets.

## [githits 0.9.2] - 2026-08-14

Patch release: improves CLI exact-path recovery and makes Claude Code and Codex
CLI initialization checks more reliable.

### Fixed

- **Exact-path recovery** - typed `FILE_NOT_FOUND` responses from CLI code read
  and grep commands now name `githits code files`, `githits code grep`, and
  `githits code read` in path-discovery guidance. Extensionless exact files use
  their containing directory, and generic `NOT_FOUND` errors do not receive
  file-path guidance.
- **Claude Code and Codex CLI init setup** - user-scoped MCP checks now run
  outside project configuration, use targeted server probes with host-specific
  timeouts, distinguish missing, non-canonical, disabled, and failed checks,
  preserve enabled customized Codex entries, and avoid reporting cleanup no-ops
  as successful setup when a later command fails.

## [@githits/mcp 0.9.1] - 2026-08-14

Patch release: improves surface-native recovery from exact-path read and grep
failures.

### Fixed

- **Exact-path recovery** - typed `FILE_NOT_FOUND` responses from `code_read`
  and `code_grep` now name `code_files`, `code_grep`, and `code_read` in
  path-discovery guidance. Extensionless exact files use their containing
  directory, and generic `NOT_FOUND` errors do not receive file-path guidance.

## [githits 0.9.1] - 2026-08-13

Patch release: silently launches a CLI-only target-resolution dogfood surface,
corrects packaged Agent Skill syntax, and improves release visibility.
`@githits/mcp` remains at 0.9.0 because this release adds no MCP tool or public
MCP package surface.

### Added

- **Target resolution CLI dogfood surface** - `githits resolve` ranks canonical
  package and GitHub repository targets with compact terminal and diagnostic
  JSON output, discoverable registry help, and terminal-safe text errors. This
  silent launch is CLI-only and is not promoted through Agent Skills or an MCP
  tool.

### Changed

- **Continuous release visibility (repository)** - notable changes now update
  this unreleased section as they land, with explicit SemVer impact for every
  public artifact, immutable historical release sections, and version-boundary
  validation during release preparation.

### Fixed

- **Search-status skill syntax (`githits`)** - agent guidance now presents
  `--wait <seconds>` as a placeholder with the valid 0-60 integer range instead
  of resembling a literal `--wait 0-60` invocation.
- **Cross-platform changelog validation (repository)** - release-boundary tests
  accept both LF and CRLF Markdown while enforcing identical package-version
  content.

## [githits 0.9.0] - 2026-08-11

Minor release: adds canonical account settings and Terms of Service commands,
improves bounded search recovery, and fixes browser login completion in proxied
or sandboxed environments. `@githits/mcp` is released alongside the CLI at
0.9.0 for the shared terms-remediation and search-recovery behavior.

### Added

- **Account settings commands** - `githits settings` now supports showing,
  reading, updating, and clearing canonical account preferences with aligned
  terminal and JSON output.
- **Terms acceptance flow** - `githits settings terms` reports acceptance state,
  while `githits settings terms accept` performs explicit confirmation and
  refreshes OAuth credentials after acceptance.

### Fixed

- **Search and grep recovery** - terminal search sessions use bounded status
  waits, deferred work provides an explicit continuation, and empty results no
  longer encourage identical retry loops across CLI text and JSON output.
- **OAuth callback completion** - browser login completes when a sandbox or
  proxy retains or closes the callback connection, without waiting for
  temporary listener teardown before token exchange and credential storage.
- **Forward-compatible settings** - newer account APIs can add fields without
  breaking older CLI settings parsing.

### Security

- **HTTP client advisories** - updated the bundled HTTP client to a patched
  release while retaining the supported Node.js 20 runtime boundary.

## [@githits/mcp 0.9.0] - 2026-08-11

Minor release: adds shared Terms of Service remediation and bounded,
agent-oriented search recovery while preserving structured errors.

### Added

- **Terms remediation** - shared REST and GraphQL failures preserve structured
  authentication errors and direct callers to the canonical terms-acceptance
  flow for both OAuth and static API-token authentication.
- **Bounded search status waits** - search status exposes backend progress
  waiting through the shared bounded default and reports explicit deferred
  continuations.

### Fixed

- **Agent retry guidance** - search, search status, and grep responses stop
  suggesting futile identical retries, retain backend diagnostics, and provide
  accurate case-sensitive and truncation-aware pivots.
- **Public declarations** - error metadata constructors remain usable from the
  standalone published declarations without changing runtime behavior.

## [githits 0.8.0] - 2026-08-07

Minor release: adds portable Agent Plugins support and improves local auth
storage reliability. `@githits/mcp` remains at 0.6.4 because this release does
not change its public package surface.

### Added

- **Portable Agent Plugins support** - the repository root can be installed as
  an Agent Plugins 1.0.0 package while retaining native Claude, Codex, Cursor,
  Gemini, Antigravity, and VS Code/GitHub Copilot adapters.
- **File-storage guidance** - authentication documentation now explains system
  keychain prompts, the explicit file-storage alternative, and its plaintext
  credential trade-off.

### Fixed

- **Auth lock identity reuse** - repeated credential operations in one process
  reuse the verified process identity instead of resolving it for every lock
  acquisition.

## [githits 0.7.0] - 2026-08-05

Minor release: consolidates the cross-host plugin packages around one canonical
skill and guidance surface. `@githits/mcp` remains at 0.6.4 because the reusable
MCP package surface is unchanged.

### Added

- **Codex and Cursor plugin packages** - generated host manifests add native
  package entry points for Codex and Cursor alongside the existing Claude,
  Gemini, and VS Code/GitHub Copilot surfaces.
- **Antigravity package** - the repository root includes the native plugin and
  remote MCP configuration required by Google Antigravity.

### Changed

- **Canonical plugin assets** - root `skills/` and `AGENTS.md` now drive every
  host package through deterministic generation, replacing duplicated Claude
  skills, commands, and payload metadata.
- **Transport boundaries** - plugin and extension installs use the hosted
  remote MCP. Direct `githits init` setup remains local stdio except for Cursor,
  which uses the hosted remote MCP.
- **MCP directory discoverability** - added repository ownership metadata and a
  README link for the Glama MCP server listing.

## [@githits/mcp 0.6.4] - 2026-08-04

Patch release: improves site-targeted search and agent-facing recovery guidance.

### Added

- **Explicit site search targets** - search requests can target supported
  documentation sites directly and render site results through the shared
  response surface.

### Fixed

- **Partial documentation coverage** - documentation reads report incomplete
  coverage instead of presenting partial results as complete.
- **Agent tool guidance** - MCP instructions better direct agents between
  search, documentation, and source-navigation tools.
