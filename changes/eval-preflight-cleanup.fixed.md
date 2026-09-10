---
"githits": none
"@githits/mcp": none
---

- **Local evaluation cleanup** - Wait for both target preflights before returning a setup failure, preventing Windows cleanup from racing an outstanding Git subprocess.
