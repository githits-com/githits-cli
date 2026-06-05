import { describe, expect, it, mock, spyOn } from "bun:test";
import { AuthenticationError } from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import { createMockGitHitsService } from "../services/test-helpers.js";
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

  it("calls service without language when --lang is omitted", async () => {
    const searchFn = mock(() => Promise.resolve("result"));
    const deps = createDeps({
      githitsService: createMockGitHitsService({ search: searchFn }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await exampleAction("hello world", {}, deps);

    expect(searchFn).toHaveBeenCalledWith({
      query: "hello world",
      language: undefined,
      licenseMode: undefined,
      includeExplanation: undefined,
    });
    consoleSpy.mockRestore();
  });

  it("outputs JSON when --json flag provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await exampleAction(
      "test",
      { lang: "javascript", json: true },
      createDeps(),
    );

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.result).toContain("# Example");
    consoleSpy.mockRestore();
  });

  it("throws AuthRequiredError on auth failure", async () => {
    await expect(
      exampleAction(
        "test",
        { lang: "python" },
        createDeps({ hasValidToken: false }),
      ),
    ).rejects.toThrow(AuthRequiredError);
  });

  it("prints JSON auth error for --json when auth is missing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      exampleAction(
        "test",
        { json: true },
        createDeps({ hasValidToken: false }),
      ),
    ).rejects.toThrow("process.exit");

    const output = errorSpy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual({
      error: "No local GitHits authentication token found.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "local" },
    });
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves CLI auth remediation when service auth fails", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        search: mock(() => Promise.reject(new AuthenticationError())),
      }),
    });

    await expect(exampleAction("test", {}, deps)).rejects.toThrow(
      "process.exit",
    );

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "Authentication required. Run `githits login` to authenticate or set GITHITS_API_TOKEN.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves CLI auth remediation in JSON when service auth fails", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        search: mock(() => Promise.reject(new AuthenticationError())),
      }),
    });

    await expect(exampleAction("test", { json: true }, deps)).rejects.toThrow(
      "process.exit",
    );

    expect(JSON.parse(errorSpy.mock.calls[0]?.[0] as string)).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "local" },
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
