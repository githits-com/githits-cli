import { describe, expect, it, mock, spyOn } from "bun:test";
import { AuthenticationError } from "../services/githits-service.js";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { AuthRequiredError } from "../shared/require-auth.js";
import { type LanguagesDependencies, languagesAction } from "./languages.js";

describe("languagesAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<LanguagesDependencies> = {},
  ): LanguagesDependencies {
    return {
      githitsService: createMockGitHitsService(),
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("lists all languages when query is undefined", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await languagesAction(undefined, {}, deps);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("javascript");
    expect(output).toContain("typescript");
    expect(output).toContain("python");
    consoleSpy.mockRestore();
  });

  it("outputs all languages as JSON when no query", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await languagesAction(undefined, { json: true }, deps);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]?.name).toBe("javascript");
    consoleSpy.mockRestore();
  });

  it("filters languages when query provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await languagesAction("python", {}, deps);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("python");
    expect(output).not.toContain("javascript");
    consoleSpy.mockRestore();
  });

  it("outputs filtered languages as JSON", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await languagesAction("java", { json: true }, deps);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.name).toBe("javascript");
    consoleSpy.mockRestore();
  });

  it("shows no-matches message when filter returns empty", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await languagesAction("nonexistent", {}, deps);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No languages matching");
    expect(output).toContain("nonexistent");
    consoleSpy.mockRestore();
  });

  it("returns empty JSON array when no matches with --json", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await languagesAction("nonexistent", { json: true }, deps);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual([]);
    consoleSpy.mockRestore();
  });

  it("throws AuthRequiredError on auth failure", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps({ hasValidToken: false });

    await expect(languagesAction(undefined, {}, deps)).rejects.toThrow(
      AuthRequiredError,
    );

    consoleSpy.mockRestore();
  });

  it("catches service error and exits with message", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        getLanguages: mock(() => Promise.reject(new Error("API error"))),
      }),
    });

    try {
      await languagesAction(undefined, {}, deps);
    } catch {
      // expected
    }

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Failed to list languages");
    expect(output).toContain("API error");
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("emits JSON auth envelope when service returns 401 in JSON mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        getLanguages: mock(() =>
          Promise.reject(new AuthenticationError("Authentication required.")),
        ),
      }),
    });

    await expect(
      languagesAction(undefined, { json: true }, deps),
    ).rejects.toThrow("process.exit");

    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "local" },
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("prints CLI auth remediation when service returns 401 in text mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        getLanguages: mock(() => Promise.reject(new AuthenticationError())),
      }),
    });

    await expect(languagesAction(undefined, {}, deps)).rejects.toThrow(
      "process.exit",
    );

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "Authentication required. Run `githits login` to authenticate or set GITHITS_API_TOKEN.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("calls getLanguages exactly once", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await languagesAction("python", {}, deps);

    expect(deps.githitsService.getLanguages).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
