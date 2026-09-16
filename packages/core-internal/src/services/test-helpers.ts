import { mock } from "bun:test";
import type { GitHitsService } from "./githits-service.js";
import type { TokenProvider } from "./token-provider.js";

export function createMockGitHitsService(
  impl: Partial<GitHitsService> = {},
): GitHitsService {
  return {
    search: mock(() =>
      Promise.resolve("# Example\n```js\nconsole.log('hi')\n```"),
    ),
    ...impl,
  };
}

export function createMockTokenProvider(
  impl: Partial<TokenProvider> = {},
): TokenProvider {
  return {
    getToken: mock(() => Promise.resolve("mock-access-token")),
    forceRefresh: mock(() => Promise.resolve("mock-refreshed-token")),
    ...impl,
  };
}
