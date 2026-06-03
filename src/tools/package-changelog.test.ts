import { describe, expect, it, mock } from "bun:test";
import {
  PackageIntelligenceChangelogSourceNotFoundError,
  PackageIntelligenceTargetNotFoundError,
} from "../services/index.js";
import {
  createMockPackageIntelligenceService,
  defaultChangelogReport,
} from "../services/test-helpers.js";
import { createPackageChangelogTool } from "./package-changelog.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createPackageChangelogTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("pkg_changelog");
    expect(tool.description).toContain("latest mode");
    expect(tool.description).toContain("range mode");
    expect(tool.description).toContain("markdown body previews");
    expect(tool.description).toContain("body_lines");
    expect(tool.description).toContain('format: "json"');
    expect(Object.keys(tool.schema).sort()).toEqual([
      "body_lines",
      "format",
      "from_version",
      "git_ref",
      "limit",
      "omit_bodies",
      "package_name",
      "registry",
      "repo_url",
      "to_version",
      "verbose",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("createPackageChangelogTool — happy path", () => {
  it("normalises spec addressing and calls service.packageChangelog", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const service = createMockPackageIntelligenceService({ packageChangelog });
    const tool = createPackageChangelogTool(service);

    await tool.handler({ registry: "npm", package_name: "express" }, {});

    const calls = packageChangelog.mock.calls as unknown as Array<
      [{ registry?: string; packageName?: string; repoUrl?: string }]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
    expect(calls[0]?.[0]?.repoUrl).toBeUndefined();
  });

  it("emits compact text by default", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("express | npm");
    expect(text).toContain("2 entries");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("uses MCP-native hint when compact changelog text truncates bodies", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({
        packageChangelog: mock(() =>
          Promise.resolve({
            ...defaultChangelogReport,
            entries: [
              {
                ...defaultChangelogReport.entries[0]!,
                body: Array.from(
                  { length: 12 },
                  (_, i) => `line ${i + 1}`,
                ).join("\n"),
              },
            ],
          }),
        ),
      }),
    );

    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(
      'pass verbose=true, body_lines=<n>, or format="json"',
    );
    expect(text).not.toContain("--verbose");
  });

  it("uses body_lines to cap MCP text previews", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({
        packageChangelog: mock(() =>
          Promise.resolve({
            ...defaultChangelogReport,
            entries: [
              {
                ...defaultChangelogReport.entries[0]!,
                body: Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join(
                  "\n",
                ),
              },
            ],
          }),
        ),
      }),
    );

    const result = await tool.handler(
      { registry: "npm", package_name: "express", body_lines: 3 },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("line 3");
    expect(text).not.toContain("line 4");
    expect(text).toContain("... (+5 more lines");
  });

  it("verbose=true renders full MCP text bodies", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({
        packageChangelog: mock(() =>
          Promise.resolve({
            ...defaultChangelogReport,
            entries: [
              {
                ...defaultChangelogReport.entries[0]!,
                body: Array.from(
                  { length: 12 },
                  (_, i) => `line ${i + 1}`,
                ).join("\n"),
              },
            ],
          }),
        ),
      }),
    );

    const result = await tool.handler(
      { registry: "npm", package_name: "express", verbose: true },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("line 12");
    expect(text).not.toContain("more line");
  });

  it("returns INVALID_ARGUMENT for conflicting or invalid text controls", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({ packageChangelog }),
    );

    const conflict = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        omit_bodies: true,
        verbose: true,
      },
      {},
    );
    expect(conflict.isError).toBe(true);
    expect((parseText(conflict) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );

    const invalid = await tool.handler(
      { registry: "npm", package_name: "express", body_lines: 0 },
      {},
    );
    expect(invalid.isError).toBe(true);
    expect((parseText(invalid) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(packageChangelog).not.toHaveBeenCalled();
  });

  it("emits the JSON envelope with entries.count computed client-side when format=json", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );
    const payload = parseText(result) as {
      registry: string;
      name: string;
      source: string;
      mode: string;
      entries: { count: number; items: unknown[] };
    };
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.source).toBe("releases");
    expect(payload.mode).toBe("latest");
    expect(payload.entries.count).toBe(2);
    expect(payload.entries.items.length).toBe(2);
  });

  it("omits source when package version entries have no changelog source", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({
        packageChangelog: mock(() =>
          Promise.resolve({
            ...defaultChangelogReport,
            source: undefined,
            entries: [defaultChangelogReport.entries[0]!],
          }),
        ),
      }),
    );

    const result = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );

    expect(result.isError).toBeUndefined();
    const payload = parseText(result) as {
      source?: string;
      entries: { count: number; items: unknown[] };
    };
    expect(payload.source).toBeUndefined();
    expect(payload.entries.count).toBe(1);
  });

  it("accepts repo_url addressing and emits repoUrl in the envelope", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { repo_url: "https://github.com/expressjs/express", format: "json" },
      {},
    );
    const payload = parseText(result) as {
      registry?: string;
      name?: string;
      repoUrl?: string;
    };
    expect(payload.repoUrl).toBe("https://github.com/expressjs/express");
    expect(payload.registry).toBeUndefined();
    expect(payload.name).toBeUndefined();
  });

  it("emits mode: 'range' and filter.fromVersion when from_version is set", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        from_version: "5.0.0",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      mode: string;
      filter?: { fromVersion?: string };
    };
    expect(payload.mode).toBe("range");
    expect(payload.filter?.fromVersion).toBe("5.0.0");
  });

  it("drops body fields when omit_bodies is true", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        omit_bodies: true,
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      entries: { items: Array<{ body?: string }> };
    };
    for (const item of payload.entries.items) {
      expect(item.body).toBeUndefined();
    }
  });

  it("ignores text-only controls for JSON output shape", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const baseline = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );
    const withTextControls = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        format: "json",
        body_lines: 3,
        verbose: true,
      },
      {},
    );
    expect(parseText(withTextControls)).toEqual(parseText(baseline));
  });

  it("keeps body fields by default", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );
    const payload = parseText(result) as {
      entries: { items: Array<{ body?: string }> };
    };
    expect(payload.entries.items[0]?.body).toBeTruthy();
  });
});

describe("createPackageChangelogTool — validation errors via in-handler builder", () => {
  it("returns INVALID_ARGUMENT when both spec and repo_url are provided", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        repo_url: "https://github.com/expressjs/express",
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("not both");
  });

  it("returns INVALID_ARGUMENT when neither addressing form is provided", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler({}, {});
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("returns INVALID_ARGUMENT for from_version + limit", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        from_version: "5.0.0",
        limit: 10,
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("latest-mode");
  });

  it("returns INVALID_ARGUMENT for tag-style from_version", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        from_version: "v4.18.0",
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("git tag");
  });

  it("returns INVALID_ARGUMENT envelope (not a raw SDK error) for out-of-range limit", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    // MCP schema is permissive; the shared builder enforces bounds.
    // This guarantees agents always see the shared envelope rather
    // than a raw Zod rejection from the SDK.
    const result = await tool.handler(
      { registry: "npm", package_name: "express", limit: 51 },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("1 and 50");
  });

  it("returns INVALID_ARGUMENT envelope for a non-integer limit", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", limit: 3.5 },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("returns INVALID_ARGUMENT for a non-URL repo_url value", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler({ repo_url: "not a url" }, {});
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("URL");
  });
});

describe("createPackageChangelogTool — service errors", () => {
  it("classifies PackageIntelligenceChangelogSourceNotFoundError as NOT_FOUND", async () => {
    const service = createMockPackageIntelligenceService({
      packageChangelog: mock(() =>
        Promise.reject(
          new PackageIntelligenceChangelogSourceNotFoundError(
            "No changelog source available for npm:ghost.",
          ),
        ),
      ),
    });
    const tool = createPackageChangelogTool(service);
    const result = await tool.handler(
      { registry: "npm", package_name: "ghost" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("NOT_FOUND");
  });

  it("classifies PackageIntelligenceTargetNotFoundError as NOT_FOUND (package missing)", async () => {
    const service = createMockPackageIntelligenceService({
      packageChangelog: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createPackageChangelogTool(service);
    const result = await tool.handler(
      { registry: "npm", package_name: "does-not-exist" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("NOT_FOUND");
  });

  it("classifies unexpected Error as UNKNOWN", async () => {
    const service = createMockPackageIntelligenceService({
      packageChangelog: mock(() => Promise.reject(new Error("boom"))),
    });
    const tool = createPackageChangelogTool(service);
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("UNKNOWN");
  });
});
