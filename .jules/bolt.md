# Bolt's Journal

## 2025-02-17 - Global process.platform Interleaving in Concurrent Testing
**Learning:** Redefining global state properties like `process.platform` in async/concurrent test suites causes state pollution and race conditions across test blocks. In Bun, concurrent test execution means async describes/its yield control, causing different platform-based mock suites to run concurrently and override the shared `process.platform` back and forth.
**Action:** Isolate mock configurations inside test execution contexts or run tests using strict serial execution (or stub process/platform on a per-function dependency injection basis) rather than mutating global/process-level state.
