---
"githits": none
"@githits/mcp": patch
---

- **Remove client telemetry lifecycle globals** - The pre-1.0 `@githits/mcp/client` telemetry lifecycle exports are removed; remote hosts inject `ServiceDiagnostics` when they need operation or debug diagnostics.
