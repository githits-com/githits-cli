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
    getLanguages: mock(() =>
      Promise.resolve([
        {
          id: "1",
          name: "javascript",
          display_name: "JavaScript",
          aliases: ["js"],
        },
        {
          id: "2",
          name: "typescript",
          display_name: "TypeScript",
          aliases: ["ts"],
        },
        {
          id: "3",
          name: "python",
          display_name: "Python",
          aliases: ["py"],
        },
      ]),
    ),
    searchLanguages: mock((query: string, limit: number = 5) => {
      const lowerQuery = query.toLowerCase();
      return Promise.resolve(
        [
          {
            id: "1",
            name: "javascript",
            display_name: "JavaScript",
            aliases: ["js"],
          },
          {
            id: "2",
            name: "typescript",
            display_name: "TypeScript",
            aliases: ["ts"],
          },
          {
            id: "3",
            name: "python",
            display_name: "Python",
            aliases: ["py"],
          },
        ]
          .filter(
            (language) =>
              language.name.toLowerCase().includes(lowerQuery) ||
              language.display_name.toLowerCase().includes(lowerQuery) ||
              language.aliases.some((alias) =>
                alias.toLowerCase().includes(lowerQuery),
              ),
          )
          .slice(0, limit),
      );
    }),
    submitFeedback: mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
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
