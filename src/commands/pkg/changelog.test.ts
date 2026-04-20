import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  PackageIntelligenceChangelogSourceNotFoundError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "../../services/index.js";
import {
  createMockPackageIntelligenceService,
  defaultChangelogReport,
} from "../../services/test-helpers.js";
import {
  type PkgChangelogCommandDependencies,
  pkgChangelogAction,
} from "./changelog.js";

describe("pkgChangelogAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<PkgChangelogCommandDependencies> = {},
  ): PkgChangelogCommandDependencies {
    return {
      packageIntelligenceService: createMockPackageIntelligenceService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("renders the default summary + one-liner entries via stdout.write", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgChangelogAction("npm:express", {}, createDeps());

    const combined = writes.join("");
    expect(combined).toContain("express · npm");
    expect(combined).toContain("source: GitHub Releases");
    expect(combined).toContain("2 entries");
    expect(combined).toContain("5.2.1");
    // Default now shows bodies (capped at 10 lines). Fixture bodies
    // are well under the cap, so full content appears without the
    // "… more lines" footer.
    expect(combined).toContain("## Patch");
    expect(combined).toContain("- fixed a thing");
    expect(combined).not.toContain("use --verbose");
    writeSpy.mockRestore();
  });

  it("renders the truncation footer when a body exceeds the default cap", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    // Service returns a single entry with 25 body lines — exceeds
    // the 10-line default cap. Expect the first 10 lines + a footer.
    const longBody = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const longReport = {
      package: { name: "big-pkg", registry: "npm", limit: 10 },
      source: "releases",
      entries: [
        {
          version: "1.0.0",
          normalizedVersion: "1.0.0",
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: longBody,
        },
      ],
    };
    await pkgChangelogAction(
      "npm:big-pkg",
      {},
      createDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: mock(() => Promise.resolve(longReport)),
        }),
      }),
    );

    const combined = writes.join("");
    expect(combined).toContain("line 1");
    expect(combined).toContain("line 10");
    expect(combined).not.toContain("line 11");
    expect(combined).toContain("+15 more lines");
    expect(combined).toContain("use --verbose for the full body");
    writeSpy.mockRestore();
  });

  it("expands bodies fully under --verbose (no truncation footer)", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    // Use a body that exceeds the default cap — under --verbose it
    // should render in full with no truncation footer.
    const longBody = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const longReport = {
      package: { name: "big-pkg", registry: "npm", limit: 10 },
      source: "releases",
      entries: [
        {
          version: "1.0.0",
          normalizedVersion: "1.0.0",
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: longBody,
        },
      ],
    };
    await pkgChangelogAction(
      "npm:big-pkg",
      { verbose: true },
      createDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: mock(() => Promise.resolve(longReport)),
        }),
      }),
    );

    const combined = writes.join("");
    expect(combined).toContain("line 1");
    expect(combined).toContain("line 25");
    expect(combined).not.toContain("use --verbose");
    expect(combined).not.toContain("more line");
    writeSpy.mockRestore();
  });

  it("emits the JSON envelope when --json is set", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgChangelogAction("npm:express", { json: true }, createDeps());

    const output = logSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.source).toBe("releases");
    expect(payload.mode).toBe("latest");
    expect(payload.entries.count).toBe(2);
    expect(payload.entries.items[0].body).toBe("## Patch\n- fixed a thing");
    logSpy.mockRestore();
  });

  it("drops body fields in JSON when --no-body is set", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    // Commander's --no-body => body: false in the action options.
    await pkgChangelogAction(
      "npm:express",
      { json: true, body: false },
      createDeps(),
    );

    const output = logSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    for (const item of payload.entries.items) {
      expect(item.body).toBeUndefined();
    }
    // Other fields preserved
    expect(payload.entries.items[0].version).toBe("5.2.1");
    expect(payload.entries.items[0].publishedAt).toBe("2026-01-15T12:00:00Z");
    logSpy.mockRestore();
  });

  it("sends spec addressing on the wire (uppercase registry, packageName)", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgChangelogAction(
      "npm:express",
      {},
      createDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog,
        }),
      }),
    );

    const calls = packageChangelog.mock.calls as unknown as Array<
      [{ registry?: string; packageName?: string; repoUrl?: string }]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
    expect(calls[0]?.[0]?.repoUrl).toBeUndefined();
    writeSpy.mockRestore();
  });

  it("sends repo-url addressing when --repo-url is set", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgChangelogAction(
      undefined,
      { repoUrl: "https://github.com/expressjs/express" },
      createDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog,
        }),
      }),
    );

    const calls = packageChangelog.mock.calls as unknown as Array<
      [{ registry?: string; packageName?: string; repoUrl?: string }]
    >;
    expect(calls[0]?.[0]?.registry).toBeUndefined();
    expect(calls[0]?.[0]?.packageName).toBeUndefined();
    expect(calls[0]?.[0]?.repoUrl).toBe("https://github.com/expressjs/express");
    writeSpy.mockRestore();
  });

  it("rejects <spec>@<version> with a hint pointing to --to / --from", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgChangelogAction("npm:express@5.0.0", {}, createDeps());
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("--to");
    expect(msg).toContain("--from");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects --from + --limit together", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgChangelogAction(
        "npm:express",
        { from: "4.0.0", limit: "10" },
        createDeps(),
      );
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("latest-mode");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects non-numeric --limit input", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgChangelogAction("npm:express", { limit: "abc" }, createDeps());
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("integer");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects --no-body + --verbose with an actionable hint", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgChangelogAction(
        "npm:express",
        { body: false, verbose: true },
        createDeps(),
      );
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("--no-body");
    expect(msg).toContain("--verbose");
    expect(msg).toContain("uncaps");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects tag-style --from versions", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgChangelogAction("npm:express", { from: "v4.0.0" }, createDeps());
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("git tag");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("routes NOT_FOUND (no changelog source) through the error envelope", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgChangelogAction(
        "npm:obscure-pkg",
        { json: true },
        createDeps({
          packageIntelligenceService: createMockPackageIntelligenceService({
            packageChangelog: mock(() =>
              Promise.reject(
                new PackageIntelligenceChangelogSourceNotFoundError(
                  "No changelog source available for npm:obscure-pkg.",
                ),
              ),
            ),
          }),
        }),
      );
    } catch {
      /* expected */
    }

    const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(payload.code).toBe("NOT_FOUND");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("renders VERSION_NOT_FOUND with structured detail lines", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgChangelogAction(
        "npm:express",
        { from: "99.0.0" },
        createDeps({
          packageIntelligenceService: createMockPackageIntelligenceService({
            packageChangelog: mock(() =>
              Promise.reject(
                new PackageIntelligenceVersionNotFoundError(
                  "No matching version found",
                  "npm:express",
                  "99.0.0",
                  undefined,
                ),
              ),
            ),
          }),
        }),
      );
    } catch {
      /* expected */
    }

    const output = errorSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("No matching version found");
    expect(output).toContain("package:   npm:express");
    expect(output).toContain("requested: 99.0.0");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("routes generic PackageIntelligenceTargetNotFoundError as NOT_FOUND", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgChangelogAction(
        "npm:does-not-exist",
        { json: true },
        createDeps({
          packageIntelligenceService: createMockPackageIntelligenceService({
            packageChangelog: mock(() =>
              Promise.reject(
                new PackageIntelligenceTargetNotFoundError("Package not found"),
              ),
            ),
          }),
        }),
      );
    } catch {
      /* expected */
    }

    const payload = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(payload.code).toBe("NOT_FOUND");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
