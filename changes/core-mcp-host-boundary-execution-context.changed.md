---
"githits": none
"@githits/mcp": minor
---

- **Add host-aware terms remediation and cancellation** - Hosted and browser-callable defaults now use canonical acceptance-URL guidance, while local CLI and stdio hosts preserve the CLI command override; explicit caller cancellation propagates through execution context so trace hooks observe rejection and cancelled work cannot refresh or retry.
