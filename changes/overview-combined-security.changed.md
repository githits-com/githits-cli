---
"githits": minor
"@githits/mcp": minor
---

- **Combined overview security with compatible native history** - Package overview selected-release counts and affectedness now include package-attributed repository findings and preserve uncertainty. Native history gains canonical `advisoryHistory.recent`; published `vulnerabilities.recent` remains as a deprecated identical alias. When combined security is unavailable, the selected `vulnerabilities` container and its old alias are omitted, not zero/false; canonical native history stays available independently. Requires the combined packageInfo schema before release or hosted adoption.
