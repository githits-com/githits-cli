import { describe, expect, it, mock } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "@githits/core-internal";
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
    expect(tool.description).toContain("one selected release");
    expect(tool.description).toContain("`registry:name@from..to`");
    expect(tool.description).toContain("body_lines");
    expect(tool.description).not.toContain("markdown body previews");
    expect(tool.description).not.toContain("Supports npm");
    expect(tool.description).not.toContain("repo_url");
    expect(tool.description).not.toContain("from_version");
    expect(tool.schema.target?.description).toContain(
      "registry:name[@version|@from..to]",
    );
    expect(tool.schema.target?.description).toContain("Package-only");
    expect(tool.schema.format?.description).toContain(
      "Set `json` only when code consumes",
    );
    expect(Object.keys(tool.schema).sort()).toEqual([
      "body_lines",
      "format",
      "limit",
      "omit_bodies",
      "target",
      "verbose",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("keeps the discovery sentence and first 80 characters stable", () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const firstSentence = tool.description.match(/^[^.]+\./)?.[0] ?? "";
    expect(firstSentence).toBe(
      "Find release notes and changelog history for a package.",
    );
    expect(firstSentence.length).toBeLessThanOrEqual(79);
    expect(tool.description.slice(0, 80)).toBe(
      "Find release notes and changelog history for a package. Default latest mode retu",
    );
  });
});

describe("createPackageChangelogTool — happy path", () => {
  it("normalises a compact target and calls service.packageChangelog", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const service = createMockPackageIntelligenceService({ packageChangelog });
    const tool = createPackageChangelogTool(service);

    await tool.handler({ target: "npm:express" }, {});

    const calls = packageChangelog.mock.calls as unknown as Array<
      [{ registry?: string; packageName?: string; version?: string }]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
    expect(calls[0]?.[0]?.version).toBeUndefined();
  });

  it("routes an exact pin through version", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve({
        ...defaultChangelogReport,
        entries: [
          {
            ...defaultChangelogReport.entries[0]!,
            hasChangelog: true,
          },
        ],
      }),
    );
    const service = createMockPackageIntelligenceService({ packageChangelog });
    const tool = createPackageChangelogTool(service);

    await tool.handler({ target: "npm:express@5.2.1", format: "json" }, {});
    const calls = packageChangelog.mock.calls as unknown as Array<
      [{ version?: string; fromVersion?: string; limit?: number }]
    >;
    expect(calls[0]?.[0]?.version).toBe("5.2.1");
    expect(calls[0]?.[0]?.fromVersion).toBeUndefined();
    expect(calls[0]?.[0]?.limit).toBeUndefined();
  });

  it("emits compact text by default", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler({ target: "npm:express" }, {});
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

    const result = await tool.handler({ target: "npm:express" }, {});
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
      { target: "npm:express", body_lines: 3 },
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
      { target: "npm:express", verbose: true },
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
        target: "npm:express",
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
      { target: "npm:express", body_lines: 0 },
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
      { target: "npm:express", format: "json" },
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
      { target: "npm:express", format: "json" },
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

  it("emits exact JSON with hasChangelog and filter.version", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({
        packageChangelog: mock(() =>
          Promise.resolve({
            ...defaultChangelogReport,
            entries: [
              {
                ...defaultChangelogReport.entries[0]!,
                hasChangelog: true,
              },
            ],
          }),
        ),
      }),
    );
    const result = await tool.handler(
      { target: "npm:express@5.2.1", format: "json" },
      {},
    );
    const payload = parseText(result) as {
      mode: string;
      filter?: { version?: string };
      entries: { items: Array<{ version?: string; hasChangelog?: boolean }> };
    };
    expect(payload.mode).toBe("exact");
    expect(payload.filter?.version).toBe("5.2.1");
    expect(payload.entries.items).toHaveLength(1);
    expect(payload.entries.items[0]?.hasChangelog).toBe(true);
  });

  it("emits mode: 'range' and filter.fromVersion for a closed interval", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        target: "npm:express@5.0.0..5.2.1",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      mode: string;
      filter?: { fromVersion?: string; toVersion?: string };
    };
    expect(payload.mode).toBe("range");
    expect(payload.filter?.fromVersion).toBe("5.0.0");
    expect(payload.filter?.toVersion).toBe("5.2.1");
  });

  it("drops body fields when omit_bodies is true", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        target: "npm:express",
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
      { target: "npm:express", format: "json" },
      {},
    );
    const withTextControls = await tool.handler(
      {
        target: "npm:express",
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
      { target: "npm:express", format: "json" },
      {},
    );
    const payload = parseText(result) as {
      entries: { items: Array<{ body?: string }> };
    };
    expect(payload.entries.items[0]?.body).toBeTruthy();
  });
});

describe("createPackageChangelogTool — validation errors via in-handler builder", () => {
  it("returns INVALID_ARGUMENT when target is missing", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({ packageChangelog }),
    );
    const result = await tool.handler({} as never, {});
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(packageChangelog).not.toHaveBeenCalled();
  });

  it("returns INVALID_ARGUMENT for a repository or site target before service access", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({ packageChangelog }),
    );
    for (const target of [
      "github:expressjs/express",
      "https://github.com/expressjs/express",
      "site:expressjs.com",
    ]) {
      const result = await tool.handler({ target }, {});
      expect(result.isError).toBe(true);
      const payload = parseText(result) as { code: string; error: string };
      expect(payload.code).toBe("INVALID_ARGUMENT");
      expect(payload.error).toContain("package-only");
    }
    expect(packageChangelog).not.toHaveBeenCalled();
  });

  it("returns INVALID_ARGUMENT for limit on an exact target", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({ packageChangelog }),
    );
    const result = await tool.handler(
      {
        target: "npm:express@5.2.1",
        limit: 10,
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("single-release");
    expect(packageChangelog).not.toHaveBeenCalled();
  });

  it("returns INVALID_ARGUMENT for limit on a lower-bound interval", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        target: "npm:express@5.0.0..",
        limit: 10,
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("latest-mode");
  });

  it("returns INVALID_ARGUMENT for a tag-style exact version", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        target: "npm:express@v4.18.0",
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
    const result = await tool.handler({ target: "npm:express", limit: 51 }, {});
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
      { target: "npm:express", limit: 3.5 },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("returns INVALID_ARGUMENT for an empty interval", async () => {
    const packageChangelog = mock(() =>
      Promise.resolve(defaultChangelogReport),
    );
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({ packageChangelog }),
    );
    const result = await tool.handler({ target: "npm:express@.." }, {});
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(packageChangelog).not.toHaveBeenCalled();
  });
});

describe("createPackageChangelogTool — service errors", () => {
  it("returns empty timeline selections as success", async () => {
    const tool = createPackageChangelogTool(
      createMockPackageIntelligenceService({
        packageChangelog: mock(() =>
          Promise.resolve({
            ...defaultChangelogReport,
            source: undefined,
            entries: [],
          }),
        ),
      }),
    );
    const result = await tool.handler(
      { target: "npm:express@9.0.0..9.1.0", format: "json" },
      {},
    );
    expect(result.isError).toBeUndefined();
    const payload = parseText(result) as {
      source?: string;
      entries: { count: number; items: unknown[] };
    };
    expect(payload.source).toBeUndefined();
    expect(payload.entries.count).toBe(0);
    expect(payload.entries.items).toEqual([]);
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
    const result = await tool.handler({ target: "npm:does-not-exist" }, {});
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("NOT_FOUND");
  });

  it("classifies unexpected Error as UNKNOWN", async () => {
    const service = createMockPackageIntelligenceService({
      packageChangelog: mock(() => Promise.reject(new Error("boom"))),
    });
    const tool = createPackageChangelogTool(service);
    const result = await tool.handler({ target: "npm:express" }, {});
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("UNKNOWN");
  });
});
