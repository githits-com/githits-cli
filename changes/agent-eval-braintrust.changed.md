---
"githits": none
"@githits/mcp": none
---

- **Braintrust agent-eval persistence** - Add maintainer-facing normalized eval export with stable channel-aware experiment names, explicit latest-main baseline linkage, harness-observed tool lifecycle timing, and native structural Braintrust tool spans without changing public artifacts. The exporter records source/channel/branch/PR/SHA identity and reports the actual linked base experiment; the first main run remains a one-time bootstrap and PR/default-local exports fail before that baseline exists. This is maintainer tooling only and has `none` SemVer impact for both public artifacts.
