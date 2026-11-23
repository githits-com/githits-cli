---
"githits": minor
"@githits/mcp": minor
---

- **vcpkg port vulnerability reports** - `pkg vulns` and `pkg_vulns` accept vcpkg versions with exact port revisions such as `vcpkg:openssl@3.6.1#2` and disclose partial advisory coverage. Advisory-by-ID JSON recognizes mapped vcpkg ports as eligible for direct installed-version checks.
