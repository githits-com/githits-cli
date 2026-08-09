# Bolt's Journal - Critical Performance Learnings

## 2026-08-09 - [State Pollution in Concurrent Tests under Bun]
**Learning:** Mutating global properties like `process.platform` in concurrent asynchronous test suites causes state pollution and race conditions across tests under Bun.
**Action:** Avoid mutating `process.platform` globally. Instead, pass `platform` or mock dependencies explicitly, or use helper functions that isolate the platform environment.
