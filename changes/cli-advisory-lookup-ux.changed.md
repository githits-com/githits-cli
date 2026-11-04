---
"githits": patch
"@githits/mcp": none
---

- **Compact advisory lookup** - Give CLI `vulns` package links, normalized affected ranges and explicit truncation, shared source attribution and prominent recovery/trust markers. Replace its unreleased raw JSON envelope with actionable package/source/coverage/diagnostic fields; original source detail now requires `--verbose`, including with `--json`. Lead with reported CVSS, label alias relationships explicitly, omit synthetic scores and remove routine success footer noise. Verbose output naturally orders version labels, removes redundant normalized inventories and repeated metadata, and keeps original JSON/Git ordering and provenance. Label verbose package-evidence records clearly and show acquisition origin only when duplicate record identities need disambiguation. JSON uses explicit affected-range/source-fix names, distinguishes numeric CVSS from raw vectors, and references exact root evidence instead of repeating verbose trees.
