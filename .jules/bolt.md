# Bolt's Performance Journal

## 2026-03-01 - Optimize Language Filtering in MCP Shared Utilities
**Learning:** In high-concurrency MCP environments, repeatedly scanning full collections using chained high-order array methods (`.filter().slice().map()`) introduces unnecessary CPU usage and temporary garbage collector overhead. By replacing the chains with a single `for-of` loop that exits early once the `limit` threshold is satisfied, we can skip processing the rest of the collection entirely. This avoids redundant string allocations (`toLowerCase`) and substring match checks for matching languages once the target count has been reached.
**Action:** Avoid chaining array operations when querying or filtering lists with a known limit. Instead, utilize early-terminating loops with `break` statement to process items in a single pass.
