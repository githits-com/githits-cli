---
"githits": patch
"@githits/mcp": none
---

- **Patch the CLI HTTP client** - Published `githits` now depends on undici 7.30.2, fixing cache and redirect response leaks between users, an SRI bypass, and cache denial of service (CVE-2026-116592, CVE-2026-116630, CVE-2026-120474, CVE-2026-120415, CVE-2026-120222, and CVE-2026-120423).
