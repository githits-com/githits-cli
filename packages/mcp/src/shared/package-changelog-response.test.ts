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

  it("emits the package addressing shape", () => {
    const envelope = buildPackageChangelogSuccessPayload(
      baseReport,
      baseOptions,
    );
    expect(envelope.registry).toBe("npm");
    expect(envelope.name).toBe("express");
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

  it("emits mode: 'exact' with filter.version and hasChangelog", () => {
    const report: ChangelogReport = {
      ...baseReport,
      source: "releases",
      entries: [
        {
          version: "5.2.1",
          normalizedVersion: "5.2.1",
          publishedAt: "2026-01-15T12:00:00Z",
          htmlUrl: "https://github.com/expressjs/express/releases/tag/5.2.1",
          body: "## Patch",
          hasChangelog: true,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, {
      ...baseOptions,
      mode: "exact",
      version: "^5.0.0",
      explicitFilterFields: new Set(["version"]),
    });
    expect(envelope.mode).toBe("exact");
    expect(envelope.filter?.version).toBe("^5.0.0");
    expect(envelope.entries.items).toHaveLength(1);
    expect(envelope.entries.items[0]?.version).toBe("5.2.1");
    expect(envelope.entries.items[0]?.hasChangelog).toBe(true);
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

  it("echoes version when caller set an exact selector", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      mode: "exact",
      version: "5.2.1",
      explicitFilterFields: new Set(["version"]),
    });
    expect(envelope.filter?.version).toBe("5.2.1");
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

  it("labels range mode with its exclusive lower bound in the summary", () => {
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
    expect(output).toContain(
      "range (4.0.0, 5.0.0] (start excluded; end included)",
    );
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

  it("says release notes are unavailable for exact no-notes results", () => {
    const report: ChangelogReport = {
      ...baseReport,
      source: "package_version",
      entries: [
        {
          version: "5.2.1",
          hasChangelog: false,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, {
      ...baseOptions,
      mode: "exact",
      version: "5.2.1",
      explicitFilterFields: new Set(["version"]),
    });
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(output).toContain("exact 5.2.1");
    expect(output).toContain("Release notes are unavailable.");
  });

  it("labels exact text with the resolved release, not the requested selector", () => {
    const report: ChangelogReport = {
      ...baseReport,
      source: "releases",
      entries: [
        {
          version: "5.2.1",
          normalizedVersion: "5.2.1",
          publishedAt: "2026-01-15T12:00:00Z",
          htmlUrl: "https://github.com/expressjs/express/releases/tag/5.2.1",
          body: "## Patch",
          hasChangelog: true,
        },
      ],
    };
    const envelope = buildPackageChangelogSuccessPayload(report, {
      ...baseOptions,
      mode: "exact",
      version: "^5.0.0",
      explicitFilterFields: new Set(["version"]),
    });
    const output = formatPackageChangelogTerminal(envelope, {
      verbose: false,
      useColors: false,
    });
    expect(envelope.filter?.version).toBe("^5.0.0");
    expect(output).toContain("exact 5.2.1");
    expect(output).not.toContain("exact ^5.0.0");
  });
});

describe("changelog classified statement evidence", () => {
  const coverage = {
    versionsClassified: 1,
    versionsNotAssessed: 0,
    versionsWithoutNotes: 0,
    versionsUnparseable: 0,
    unitsNoImpact: 133,
    itemsMustActConfident: 13,
    itemsMustActAmbiguous: 28,
    itemsShouldKnowConfident: 12,
    itemsShouldKnowAmbiguous: 10,
    itemsUnclassified: 1,
    itemsOmitted: 13,
  };
  const item = {
    version: "v5.2.1",
    tier: "MUST_ACT" as const,
    ambiguous: false,
    tierConfidence: 0.1,
    kind: "CHANGES_BEHAVIOR_OR_DEFAULT",
    kindConfidence: 0.9,
    text: "Removed a public default.",
    textTruncated: false,
    fullText: "Removed a public default.",
    url: "https://example.com/history#v5.2.1",
    source: "CHANGELOG_FILE",
    heading: "Changes",
    model: "jev-old",
    formulation: "s-hier-v2",
  };
  const report: ChangelogReport = {
    ...baseReport,
    entries: [
      {
        ...baseReport.entries[0],
        version: "v5.2.1",
        normalizedVersion: "5.2.1",
        body: "## Notes\n- original preview",
      },
    ],
    riskCoverage: coverage,
    riskItems: [
      item,
      {
        ...item,
        ambiguous: true,
        tierConfidence: 0.95,
        text: "Possible behavior change.",
        model: "jev-new",
        formulation: "s-hier-v5",
      },
      {
        ...item,
        tier: "SHOULD_KNOW",
        kind: undefined,
        text: "A kindless notable statement.",
        url: "https://example.com/release",
      },
      {
        ...item,
        tier: "UNCLASSIFIED",
        kind: undefined,
        tierConfidence: undefined,
        text: "Large statement.",
        textTruncated: true,
      },
    ],
  };
  const payload = (): ReturnType<typeof buildPackageChangelogSuccessPayload> =>
    buildPackageChangelogSuccessPayload(report, baseOptions);
  it("preserves note previews and joins by raw version, showing server uncertainty separately", () => {
    const text = formatPackageChangelogTerminal(payload(), {
      useColors: false,
      terminalWidth: 160,
    });
    expect(text).toContain("original preview");
    expect(text).toContain(
      'Requires action\n    * [behavior] "Removed a public default."',
    );
    expect(text).toContain(
      'Possibly requires action\n    * [behavior] (uncertain) "Possible behavior change."',
    );
    expect(text).toContain(
      'Should know\n    * "A kindless notable statement."',
    );
    expect(text).toContain("Too long to classify - read it");
    expect(text).not.toContain("Requires action (");
    expect(text).not.toContain("jev-old");
    expect(text).not.toContain("Not a compatibility verdict");
    expect(text).toContain("13 require action (+28 uncertain)");
    expect(text).toContain("133 statements labeled no impact");
    expect(text).toContain("13 matching statements omitted by backend");
    expect(text).toContain("statement truncated by backend; fullText in JSON");
    expect(text.match(/https:\/\/example.com\/history#v5.2.1/g)).toHaveLength(
      1,
    );
  });
  it("does not mislabel a release URL with the aggregate changelog-file source", () => {
    const primary = "https://example.com/releases/5.2.1";
    const json = buildPackageChangelogSuccessPayload(
      {
        ...report,
        source: "changelog_file",
        entries: [
          { version: "v5.2.1", htmlUrl: primary, body: "release preview" },
        ],
        riskItems: [{ ...item, url: primary, source: "RELEASES" }],
      },
      baseOptions,
    );
    const text = formatPackageChangelogTerminal(json, { useColors: false });
    expect(text).toContain(`Release notes: ${primary}`);
    expect(text).not.toContain(`Changelog: ${primary}`);
  });
  it("distinguishes note references from owned citations and hides unshown excerpt URLs", () => {
    const primary = "https://example.com/history";
    const hidden = "https://example.com/hidden";
    const json = buildPackageChangelogSuccessPayload(
      {
        ...report,
        entries: [
          {
            version: "v5.2.1",
            htmlUrl: primary,
            body: "- Fixed parser [#12][2]\nSee [3] and [manual](https://example.com/manual)",
          },
        ],
        riskItems: [
          {
            ...item,
            tier: "SHOULD_KNOW",
            url: primary,
            text: `${"A noteworthy statement ".repeat(30)} ${hidden}`,
            heading: "Extra [4] details https://example.com/heading",
          },
        ],
      },
      baseOptions,
    );
    const compact = formatPackageChangelogTerminal(json, { useColors: false });
    expect(compact).toContain("[#12][2]");
    expect(compact).not.toContain("[#12](2)");
    expect(compact).toContain("See [3]");
    expect(compact).toContain("[manual](https://example.com/manual)");
    expect(compact).not.toContain(hidden);
    expect(json.entries.items[0]?.body).toContain("[#12][2]");
    const verbose = formatPackageChangelogTerminal(json, {
      useColors: false,
      verbose: true,
    });
    expect(verbose).toContain(hidden);
    expect(verbose).toContain("https://example.com/heading");
    expect(verbose).toContain("Extra (4)");
  });
  it("does not admit hidden sources from relative links or authored citation markers", () => {
    for (const authored of [
      "[S2](../MIGRATION.md)",
      "[S2]",
      "[2](../MIGRATION.md)",
    ]) {
      const hidden = "https://example.com/hidden";
      const json = buildPackageChangelogSuccessPayload(
        {
          ...report,
          entries: [
            { version: "v5.2.1", htmlUrl: item.url, body: "Notes [2]" },
          ],
          riskItems: [
            {
              ...item,
              tier: "SHOULD_KNOW",
              text: `Migration ${authored}. ${"Longer change details ".repeat(30)} ${hidden}`,
            },
          ],
        },
        baseOptions,
      );
      const text = formatPackageChangelogTerminal(json, { useColors: false });
      expect(text).not.toContain(hidden);
      expect(text).toContain("[S1]");
      expect(text).toContain("Notes [2]");
    }
  });
  it("retains all per-item provenance and full text in JSON without mutating the report", () => {
    const json = payload();
    expect(json.riskCoverage).toEqual(coverage);
    expect(json.riskItems?.[0]).toMatchObject({
      ...item,
      tier: "must_act",
      kind: "changes_behavior_or_default",
      source: "changelog_file",
    });
    expect(json.riskItems?.[1]?.formulation).toBe("s-hier-v5");
    expect(report.riskItems?.[0]?.tier).toBe("MUST_ACT");
  });
  it("keeps all-tier totals while echoing the narrower active view", () => {
    const json = buildPackageChangelogSuccessPayload(
      { ...report, riskItems: [item] },
      {
        ...baseOptions,
        changes: "actionable",
        explicitFilterFields: new Set(["changes"]),
      },
    );
    const text = formatPackageChangelogTerminal(json, {
      useColors: false,
      terminalWidth: 180,
    });
    expect(json.filter?.changes).toBe("actionable");
    expect(text).toContain(
      "Showing actionable statements; note previews and totals include all tiers.",
    );
    expect(text).toContain("12 should know (+10 uncertain)");
  });
  it("omits both bodies and classification from the timeline envelope", () => {
    const json = buildPackageChangelogSuccessPayload(report, {
      ...baseOptions,
      includeBodies: false,
    });
    expect(json.riskItems).toBeUndefined();
    expect(json.riskCoverage).toBeUndefined();
    expect(json.entries.items[0]?.body).toBeUndefined();
    const text = formatPackageChangelogTerminal(json, { useColors: false });
    expect(text).toContain("v5.2.1");
    expect(text).not.toContain("classified");
    expect(text).not.toContain("Removed a public default");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
  it("ends classified output without sources with one newline", () => {
    const json = buildPackageChangelogSuccessPayload(
      {
        ...report,
        entries: [{ version: item.version, body: "Notes" }],
        riskItems: [{ ...item, url: undefined }],
      },
      baseOptions,
    );
    const text = formatPackageChangelogTerminal(json, { useColors: false });
    expect(text).not.toContain("Sources");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
  it("omits the Sources heading when its only URL is hidden by an excerpt", () => {
    const hiddenUrl = "https://example.com/hidden-tail";
    const json = buildPackageChangelogSuccessPayload(
      {
        ...report,
        entries: [{ version: item.version, body: "Notes" }],
        riskItems: [
          {
            ...item,
            url: undefined,
            tier: "SHOULD_KNOW",
            text: `${"Longer change details ".repeat(30)} ${hiddenUrl}`,
          },
        ],
      },
      baseOptions,
    );
    const text = formatPackageChangelogTerminal(json, { useColors: false });
    expect(text).toContain("Quotes ending in ... are excerpts");
    expect(text).not.toContain(hiddenUrl);
    expect(text).not.toContain("Sources");
    expect(text.endsWith("\n\n")).toBe(false);
  });
  it("honestly reports entirely pending, missing and unparseable versions with zero quotes", () => {
    const json = buildPackageChangelogSuccessPayload(
      {
        ...report,
        riskItems: [],
        riskCoverage: {
          ...coverage,
          versionsClassified: 0,
          versionsNotAssessed: 4,
          versionsWithoutNotes: 2,
          versionsUnparseable: 1,
          itemsOmitted: 0,
        },
      },
      baseOptions,
    );
    const text = formatPackageChangelogTerminal(json, {
      useColors: false,
      terminalWidth: 160,
    });
    expect(text).toContain(
      "0 classified | 4 not assessed | 2 without notes | 1 unparseable",
    );
    expect(text).toContain("No matching classified statements returned");
    expect(text).toContain("Rerun in a few seconds to a minute");
    expect(text).toContain(
      "Missing or unparseable notes are not evidence of no risk",
    );
    expect(text.toLowerCase()).not.toContain("safe");
  });
  it("expands local excerpts in verbose but never uses JSON fullText as terminal evidence", () => {
    const body = `${"Notable sentence ".repeat(30)}END`;
    const json = buildPackageChangelogSuccessPayload(
      {
        ...report,
        riskItems: [
          {
            ...item,
            tier: "SHOULD_KNOW",
            text: body,
            fullText: "JSON_ONLY_SECRET_SENTINEL",
          },
        ],
      },
      baseOptions,
    );
    const compact = formatPackageChangelogTerminal(json, { useColors: false });
    expect(compact).not.toContain("END");
    expect(compact).toContain("Quotes ending in ...");
    const verbose = formatPackageChangelogTerminal(json, {
      useColors: false,
      verbose: true,
    });
    expect(verbose).toContain("END");
    expect(verbose).not.toContain("JSON_ONLY_SECRET_SENTINEL");
  });
  it("sanitizes body, quote, metadata and source controls while keeping JSON raw", () => {
    const controlSequence = "\u001b[31m";
    const dirty = {
      ...report,
      entries: [
        {
          version: "v5.2.1",
          body: `before${controlSequence}after\nsecond\u0007line`,
        },
      ],
      riskItems: [
        {
          ...item,
          text: `quoted${controlSequence}statement`,
          url: `https://example.com/${controlSequence}notes`,
          heading: `dirty${controlSequence}heading`,
        },
      ],
    };
    const json = buildPackageChangelogSuccessPayload(dirty, baseOptions);
    const text = formatPackageChangelogTerminal(json, {
      useColors: false,
      verbose: true,
    });
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u0007");
    expect(text).toContain("beforeafter");
    expect(text).toContain("secondline");
    expect(text).toContain("quotedstatement");
    expect(json.riskItems?.[0]?.text).toContain(controlSequence);
  });
  it("wraps statement prose at the caller width and keeps labels visible without color", () => {
    const json = buildPackageChangelogSuccessPayload(
      {
        ...report,
        riskItems: [
          {
            ...item,
            text: "This public default changes the request behavior for existing application callers and requires examining each current call site.",
          },
        ],
      },
      baseOptions,
    );
    const text = formatPackageChangelogTerminal(json, {
      useColors: false,
      terminalWidth: 45,
    });
    const quoted = text
      .split("\n")
      .filter((line) => line.startsWith("    *") || line.startsWith("      "));
    expect(quoted.length).toBeGreaterThan(2);
    expect(quoted.every((line) => line.length <= 45)).toBe(true);
    expect(text).toContain("[behavior]");
  });
});
