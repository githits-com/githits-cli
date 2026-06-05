import { describe, expect, it } from "bun:test";
import type { ChangelogReport } from "@githits/core-internal";
import type { ExplicitFilterField } from "./package-changelog-request.js";
import {
  buildPackageChangelogSuccessPayload,
  formatPackageChangelogTerminal,
} from "./package-changelog-response.js";

const baseReport: ChangelogReport = {
  package: {
    name: "express",
    registry: "npm",
    limit: 10,
  },
  source: "releases",
  entries: [
    {
      version: "5.2.1",
      normalizedVersion: "5.2.1",
      publishedAt: "2026-01-15T12:00:00Z",
      htmlUrl: "https://github.com/expressjs/express/releases/tag/5.2.1",
      body: "## Patch\n- fixed a thing",
    },
    {
      version: "5.2.0",
      normalizedVersion: "5.2.0",
      publishedAt: "2025-12-10T09:00:00Z",
      htmlUrl: "https://github.com/expressjs/express/releases/tag/5.2.0",
      body: "## Minor\n- added WebSocket support",
    },
  ],
};

const baseOptions = {
  registry: "npm",
  name: "express",
  mode: "latest" as const,
  explicitFilterFields: new Set<ExplicitFilterField>(),
  includeBodies: true,
};

describe("buildPackageChangelogSuccessPayload — envelope shape", () => {
  it("emits the data-first envelope with entries.count computed client-side", () => {
    const envelope = buildPackageChangelogSuccessPayload(
      baseReport,
      baseOptions,
    );
    expect(envelope.registry).toBe("npm");
    expect(envelope.name).toBe("express");
    expect(envelope.source).toBe("releases");
    expect(envelope.mode).toBe("latest");
    expect(envelope.entries.count).toBe(2);
    expect(envelope.entries.items.length).toBe(2);
    expect(envelope.entries.count).toBe(envelope.entries.items.length);
  });

  it("preserves version/normalizedVersion/publishedAt/htmlUrl/body on each entry", () => {
    const envelope = buildPackageChangelogSuccessPayload(
      baseReport,
      baseOptions,
    );
    expect(envelope.entries.items[0]).toEqual({
      version: "5.2.1",
      normalizedVersion: "5.2.1",
      publishedAt: "2026-01-15T12:00:00Z",
      htmlUrl: "https://github.com/expressjs/express/releases/tag/5.2.1",
      body: "## Patch\n- fixed a thing",
    });
  });

  it("emits the repo-URL addressing shape when no registry/name are set", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      registry: undefined,
      name: undefined,
      repoUrl: "https://github.com/expressjs/express",
    });
    expect(envelope.registry).toBeUndefined();
    expect(envelope.name).toBeUndefined();
    expect(envelope.repoUrl).toBe("https://github.com/expressjs/express");
  });
});

describe("buildPackageChangelogSuccessPayload — version null handling", () => {
  it("keeps version: null on entries missing a version", () => {
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: undefined,
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: "raw changelog",
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    expect(envelope.entries.items[0]?.version).toBeNull();
    expect(envelope.entries.items[0]?.publishedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("strips normalizedVersion / publishedAt / htmlUrl / body when null", () => {
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          normalizedVersion: undefined,
          publishedAt: undefined,
          htmlUrl: undefined,
          body: undefined,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const entry = envelope.entries.items[0];
    expect(entry?.version).toBe("1.0.0");
    expect(entry?.normalizedVersion).toBeUndefined();
    expect(entry?.publishedAt).toBeUndefined();
    expect(entry?.htmlUrl).toBeUndefined();
    expect(entry?.body).toBeUndefined();
  });

  it("preserves empty-string body (distinct from null) so agents can tell 'empty notes' from 'no notes field'", () => {
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          body: "",
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    expect(envelope.entries.items[0]?.body).toBe("");
  });

  it("omits source when package version entries have no changelog entry", () => {
    const report: ChangelogReport = {
      ...baseReport,
      source: undefined,
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    expect(envelope.source).toBeUndefined();
    expect(envelope.entries.count).toBe(2);
  });
});

describe("buildPackageChangelogSuccessPayload — body omission lever", () => {
  it("drops body fields from every entry when includeBodies is false", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      includeBodies: false,
    });
    for (const entry of envelope.entries.items) {
      expect(entry.body).toBeUndefined();
    }
    // Other fields preserved.
    expect(envelope.entries.items[0]?.version).toBe("5.2.1");
    expect(envelope.entries.items[0]?.publishedAt).toBe("2026-01-15T12:00:00Z");
    expect(envelope.entries.items[0]?.htmlUrl).toBeTruthy();
  });
});

describe("buildPackageChangelogSuccessPayload — mode derivation", () => {
  it("emits mode: 'range' when the caller sent a fromVersion", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      mode: "range",
      fromVersion: "5.0.0",
      explicitFilterFields: new Set(["fromVersion"]),
    });
    expect(envelope.mode).toBe("range");
    expect(envelope.filter?.fromVersion).toBe("5.0.0");
  });

  it("emits mode: 'latest' otherwise", () => {
    const envelope = buildPackageChangelogSuccessPayload(
      baseReport,
      baseOptions,
    );
    expect(envelope.mode).toBe("latest");
  });
});

describe("buildPackageChangelogSuccessPayload — filter echo", () => {
  it("emits filter only when at least one field was explicit", () => {
    const noFilter = buildPackageChangelogSuccessPayload(
      baseReport,
      baseOptions,
    );
    expect(noFilter.filter).toBeUndefined();

    const withLimit = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      limit: 5,
      explicitFilterFields: new Set(["limit"]),
    });
    expect(withLimit.filter?.limit).toBe(5);
    expect(withLimit.filter?.fromVersion).toBeUndefined();
    expect(withLimit.filter?.toVersion).toBeUndefined();
  });

  it("does not echo backend-default values (limit=10 from wire)", () => {
    // Backend might echo limit=10 on the package info, but we don't
    // mirror that — only explicit caller inputs.
    const envelope = buildPackageChangelogSuccessPayload(
      baseReport,
      baseOptions,
    );
    expect(envelope.filter).toBeUndefined();
  });

  it("echoes gitRef when caller set it", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      gitRef: "develop",
      explicitFilterFields: new Set(["gitRef"]),
    });
    expect(envelope.filter?.gitRef).toBe("develop");
  });
});

describe("buildPackageChangelogSuccessPayload — empty entries", () => {
  it("emits entries: { count: 0, items: [] } on zero-entry response", () => {
    const report: ChangelogReport = {
      ...baseReport,
      entries: [],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    expect(envelope.entries.count).toBe(0);
    expect(envelope.entries.items).toEqual([]);
    expect(envelope.source).toBe("releases");
  });
});

describe("formatPackageChangelogTerminal", () => {
  it("renders a summary header + one-line entries by default", () => {
    const envelope = buildPackageChangelogSuccessPayload(
      baseReport,
      baseOptions,
    );
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("express | npm");
    expect(output).toContain("source: GitHub Releases");
    expect(output).toContain("2 entries");
    expect(output).toContain("5.2.1");
    expect(output).toContain("2026-01-15");
    expect(output).toContain("/releases/tag/5.2.1");
    // Fixture bodies are well under the 10-line cap, so they render
    // in full without a truncation footer.
    expect(output).toContain("## Patch");
    expect(output).toContain("- fixed a thing");
    expect(output).not.toContain("use --verbose");
  });

  it("labels no-source package entries as package versions", () => {
    const report: ChangelogReport = { ...baseReport, source: undefined };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("source: package versions");
  });

  it("caps the body at 10 lines by default with a truncation footer", () => {
    const longBody = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: longBody,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("line 1");
    expect(output).toContain("line 10");
    expect(output).not.toContain("line 11");
    expect(output).toContain("+15 more lines");
    expect(output).toContain("use --verbose for the full body");
    expect(output).toContain(
      "... (+15 more lines - use --verbose for the full body)",
    );
  });

  it("uses caller-supplied body preview line cap", () => {
    const longBody = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: longBody,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
      bodyPreviewLines: 3,
      fullBodyHint: "pass verbose=true",
    });
    expect(output).toContain("line 3");
    expect(output).not.toContain("line 4");
    expect(output).toContain("... (+5 more lines - pass verbose=true)");
  });

  it("lifts the body cap under --verbose and omits the truncation footer", () => {
    const longBody = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: longBody,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: true,
      useColors: false,
    });
    expect(output).toContain("line 1");
    expect(output).toContain("line 25");
    expect(output).not.toContain("use --verbose");
    expect(output).not.toContain("more line");
  });

  it("uses singular wording in the truncation footer when exactly one line is hidden", () => {
    const elevenLines = Array.from(
      { length: 11 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: elevenLines,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("+1 more line ");
    expect(output).not.toContain("+1 more lines");
  });

  it("renders '(unversioned)' for entries with no version", () => {
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: undefined,
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: "raw",
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("(unversioned)");
  });

  it("renders a dash for missing publishedAt", () => {
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          publishedAt: undefined,
          htmlUrl: "https://example.com",
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("-");
  });

  it("renders 'No entries in this range.' on zero-entry success", () => {
    const report: ChangelogReport = { ...baseReport, entries: [] };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("No entries in this range.");
  });

  it("labels range mode with from -> to in the summary", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      mode: "range",
      fromVersion: "4.0.0",
      toVersion: "5.0.0",
      explicitFilterFields: new Set(["fromVersion", "toVersion"]),
    });
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("range 4.0.0 -> 5.0.0");
  });

  it("renders printable ASCII punctuation", () => {
    const longBody = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          publishedAt: undefined,
          htmlUrl: "https://example.com",
          body: longBody,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, {
      ...baseOptions,
      mode: "range",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      explicitFilterFields: new Set(["fromVersion", "toVersion"]),
    });
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).not.toMatch(/[·…—–→]/);
  });

  it("labels latest mode with 'latest up to X' when toVersion is set", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      toVersion: "5.2.1",
      explicitFilterFields: new Set(["toVersion"]),
    });
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("latest up to 5.2.1");
  });

  it("renders '(empty release notes)' sentinel for an empty-string body under --verbose", () => {
    const report: ChangelogReport = {
      ...baseReport,
      entries: [
        {
          version: "1.0.0",
          publishedAt: "2026-01-01T00:00:00Z",
          htmlUrl: "https://example.com",
          body: "",
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, baseOptions);
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: true,
      useColors: false,
    });
    expect(output).toContain("(empty release notes)");
  });

  it("uses the repo URL as identity in repo-URL addressing", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      registry: undefined,
      name: undefined,
      repoUrl: "https://github.com/expressjs/express",
    });
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("https://github.com/expressjs/express");
  });
});
