import { describe, expect, it, mock, spyOn } from "bun:test";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { type SearchDependencies, searchAction } from "./search.js";

describe("searchAction", () => {
  function createDeps(
    overrides: Partial<SearchDependencies> = {},
  ): SearchDependencies {
    return {
      githitsService: createMockGitHitsService(),
      ...overrides,
    };
  }

  it("calls service with query, language, and license mode", async () => {
    const searchFn = mock(() => Promise.resolve("result"));
    const deps = createDeps({
      githitsService: createMockGitHitsService({ search: searchFn }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction(
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

  it("passes --explain flag to service as includeExplanation", async () => {
    const searchFn = mock(() => Promise.resolve("result"));
    const deps = createDeps({
      githitsService: createMockGitHitsService({ search: searchFn }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await searchAction("test", { lang: "python", explain: true }, deps);

    expect(searchFn).toHaveBeenCalledWith({
      query: "test",
      language: "python",
      licenseMode: undefined,
      includeExplanation: true,
    });
    consoleSpy.mockRestore();
  });

  it("outputs markdown result by default", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await searchAction("test query", { lang: "javascript" }, deps);

    expect(consoleSpy).toHaveBeenCalledWith(
      "# Example\n```js\nconsole.log('hi')\n```",
    );
    consoleSpy.mockRestore();
  });

  it("outputs JSON when --json flag provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await searchAction("test", { lang: "javascript", json: true }, deps);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.result).toContain("# Example");
    consoleSpy.mockRestore();
  });

  it("catches service error and exits with message", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        search: mock(() => Promise.reject(new Error("Network timeout"))),
      }),
    });

    try {
      await searchAction("test", { lang: "python" }, deps);
    } catch {
      // expected
    }

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Failed to search");
    expect(output).toContain("Network timeout");
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
