import { describe, expect, it, mock, spyOn } from "bun:test";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { AuthRequiredError } from "../shared/require-auth.js";
import { type ExampleDependencies, exampleAction } from "./example.js";

describe("exampleAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<ExampleDependencies> = {},
  ): ExampleDependencies {
    return {
      githitsService: createMockGitHitsService(),
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("calls service with query, language, and license mode", async () => {
    const searchFn = mock(() => Promise.resolve("result"));
    const deps = createDeps({
      githitsService: createMockGitHitsService({ search: searchFn }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await exampleAction(
      "hello world",
      { lang: "python", license: "yolo" },
      deps,
    );

    expect(searchFn).toHaveBeenCalledWith({
      query: "hello world",
      language: "python",
      licenseMode: "yolo",
      includeExplanation: undefined,
    });
    consoleSpy.mockRestore();
  });

  it("outputs JSON when --json flag provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await exampleAction("test", { lang: "javascript", json: true }, createDeps());

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.result).toContain("# Example");
    consoleSpy.mockRestore();
  });

  it("throws AuthRequiredError on auth failure", async () => {
    await expect(
      exampleAction("test", { lang: "python" }, createDeps({ hasValidToken: false })),
    ).rejects.toThrow(AuthRequiredError);
  });
});
