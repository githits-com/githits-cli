---
"githits": major
"@githits/mcp": none
---

- **CLI wait units** - Search and search-status now interpret numeric --wait values as milliseconds, matching every other wait-bearing command and emitted retry action. Replace --wait 30 or --wait 30s with --wait 30000 for 30 seconds; the seconds suffix is no longer accepted. Update the public CLI code skill and code-and-docs reference during release preparation so published guidance matches the released CLI.
