# GitHits Package CLI Reference

## Package Info

`githits pkg info <registry:name>` returns latest-version triage: license, description, repository popularity, downloads, publish age, and separate latest-affected and package-wide advisory-history scopes. Use `--verbose` for GitHub language/topics/last-pushed, package-wide advisory history (all versions), published-version count, download freshness, and recent changes. Use `--json` for structured fields.

Supported registries include npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, Swift, vcpkg, and Zig.
Swift package targets use `swift:github.com/<owner>/<repo>` or `swift:gitlab.com/<group>/<project>`; Zig package targets use `zig:gh/<owner>/<repo>` or `zig:cb/<owner>/<repo>`. Keep these registry-native coordinates for package evidence; direct repository targets inspect the full repository.

## Vulnerabilities

`githits pkg vulns <registry:name[@version]>` lists known OSV/CVE advisories. Omit the version for latest.

Flags: `--severity low|medium|high|critical`, `--scope affected|non_affecting|all`, `--include-withdrawn`, `--transitive`, `--verbose`, `--json`.

Direct-only is the default. `--transitive` adds vulnerability evidence for versions in the resolved dependency graph, at additional graph-analysis cost; it does not inspect a local application lockfile. `--severity` and `--scope` apply to root and dependency rows. `--include-withdrawn` affects direct rows only; transitive withdrawn advisories remain excluded. Use `--scope all` for affected plus historical dependency advisories, or `--scope non_affecting` for historical rows.

CLI text shows every selected direct and transitive advisory row. `--verbose` adds aliases, dates, malicious-advisory markers, and complete range/fix evidence; `--json` retains structured advisory-wide affected ranges and fixed versions. Compact MCP text remains capped; use `verbose:true` for all selected rows.

Supported registries: npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, Swift. vcpkg and Zig are unsupported for vulnerability data.

## Dependencies

`githits pkg deps <registry:name[@version]>` lists direct runtime dependencies by default.

Flags: `--lifecycle runtime|development|build|peer|optional|all`, `--depth 1-10`, `--verbose`, `--json`.

Supported dependency registries: npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, Swift, vcpkg, and Zig.

Use `--depth` to request transitive output capped to that traversal depth. Omit it for direct dependencies only.

## Changelog

`githits pkg changelog <registry:name>` returns recent release notes. `--limit` caps latest mode. `--from` is the exclusive lower bound for range mode, which returns entries after `--from` through `--to` (or latest).

Flags: `--repo-url <url>`, `--from <version>`, `--to <version>`, `--limit 1-50`, `--git-ref <ref>`, `--verbose`, `--no-body`, `--json`.

Do not use `registry:name@version` for changelog. Use `--to <version>`.

For repository changelogs, pass a full HTTPS URL on github.com, codeberg.org, or gitlab.com to `--repo-url`; use `--git-ref` for a branch or tag. Codeberg requires owner/repo; GitLab permits nested namespaces. Do not pass compact `github:`, `codeberg:`, or `gitlab:` targets to this URL field.

## Upgrade Review

`githits pkg upgrade-review <registry:name@current> --to <target>` compares current and target package versions and reports upgrade evidence without assigning risk.

Batch form: `githits pkg upgrade-review --package <registry:name@current>..<target> --package <registry:name@current>..<target>`.

Evidence includes current and target direct vulnerabilities, changelog range evidence, target deprecation metadata, peer dependency changes, dependency changes, and transitive security by default. Dependency-issue diffs are opt-in with `--dependency-issues`.

Flags: `--package <spec>`, `--to <version>`, `--no-transitive-security`, `--dependency-issues`, `--min-severity low|medium|high|critical`, `--verbose`, `--json`.

Use `pkg upgrade-review` for dependency update assessment instead of inferring safety from semver alone. Use `pkg changelog` directly only when you need release notes without a current-to-target comparison.

## Command Name Mapping

- `githits pkg info` maps to MCP `pkg_info`.
- `githits pkg vulns` maps to MCP `pkg_vulns`; CLI `--transitive` maps to `include_transitive:true`.
- `githits pkg deps` maps to MCP `pkg_deps`.
- `githits pkg changelog` maps to MCP `pkg_changelog`.
- `githits pkg upgrade-review` maps to MCP `pkg_upgrade_review`.
