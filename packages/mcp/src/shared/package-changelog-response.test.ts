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
  view: "verbatim" as const,
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
  it("drops body fields from every timeline entry", () => {
    const envelope = buildPackageChangelogSuccessPayload(baseReport, {
      ...baseOptions,
      view: "timeline",
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

describe("complete statement evidence view", () => {
  function evidence(): ChangelogReport {
    return {
      ...structuredClone(baseReport),
      statements: {
        totalCount: 5,
        matchingCount: 5,
        items: [
          "MUST_ACT",
          "SHOULD_KNOW",
          "NO_IMPACT",
          "UNCLASSIFIED",
          null,
        ].map((tier, position) => ({
          version: "5.2.1",
          position,
          sourceIndex: position < 3 ? 0 : 1,
          sourcePosition: position,
          heading: "Patch",
          source: position < 3 ? "CHANGELOG_FILE" : "RELEASES",
          url:
            position < 3
              ? "https://example.com/history#L1"
              : "https://example.com/releases/5.2.1",
          text: `* Quoted statement ${position}${position === 0 ? "\n  * nested wording\n\n  ```js\n  foo(  1)\n  ```" : ""}`,
          fullText: "Full uncut statement",
          textTruncated: position === 3,
          ...(position === 3
            ? {
                context: {
                  heading: "Earlier",
                  text: "Earlier quote",
                  textTruncated: false,
                  fullText: "Earlier uncut quote",
                },
              }
            : {}),
          classification:
            tier === null
              ? null
              : {
                  tier: tier as "MUST_ACT",
                  ambiguous: position < 2,
                  tierConfidence: 0.95,
                  kind:
                    position === 0 ? "CHANGES_BEHAVIOR_OR_DEFAULT" : undefined,
                  model: "jev",
                  formulation: position < 3 ? "s-hier-v5" : "s-hier-v3",
                },
        })),
        coverage: [
          {
            version: "5.2.1",
            status: "NOT_ASSESSED",
            statementsTotal: 5,
            statementsAssessed: 4,
            statementsNotAssessed: 1,
            statementsNoImpact: 1,
            statementsUnclassified: 1,
          },
        ],
      },
    };
  }
  function payload(report = evidence(), changes?: "actionable" | "important") {
    return buildPackageChangelogSuccessPayload(report, {
      ...baseOptions,
      view: "statements",
      changes,
      explicitFilterFields: new Set(changes ? ["changes"] : []),
    });
  }
  it("renders all parsed units once, source URLs nearby, without raw-note duplication", () => {
    const text = formatPackageChangelogTerminal(payload(), {
      useColors: false,
      terminalWidth: 200,
    });
    expect(text).not.toContain("## Patch");
    expect(text).not.toContain("Sources");
    expect(text.split("https://example.com/history#L1")).toHaveLength(2);
    expect(text.indexOf("https://example.com/history#L1")).toBeLessThan(
      text.indexOf("Quoted statement 0"),
    );
    expect(text).toContain("! requires action | kind tags: should know");
    expect(text).toContain("* [!behavior] (uncertain) Quoted statement 0");
    expect(text).toContain("* [should know] (uncertain) Quoted statement 1");
    expect(text).toContain("* Quoted statement 2");
    expect(text).toContain("[too long to classify - read it]");
    expect(text).toContain("[not assessed]");
    expect(text).not.toContain("[no impact identified]");
    expect(text).not.toContain("[requires action");
    expect(text).not.toContain("* i ");
    expect(text.match(/\(uncertain\)/g)).toHaveLength(2);
    expect(text).toContain("nested wording");
    expect(text).toContain("foo(  1)");
    expect(text).toContain("Earlier quote");
    expect(text).toContain("Statement truncated");
    expect(text).toContain("still in progress or failed");
    expect(text).not.toContain("jev");
    expect(text).not.toContain("Full uncut statement");
  });
  it("leaves no-impact bullets untagged, preserving uncertainty and JSON evidence", () => {
    const report = evidence();
    const item = report.statements!.items[2]!;
    item.classification!.kind = "NOTABLE_CHANGE";
    item.classification!.ambiguous = true;
    report.statements!.items = [item];
    const text = formatPackageChangelogTerminal(payload(report), {
      useColors: false,
    });
    expect(text).toContain("* (uncertain) Quoted statement 2");
    expect(text).not.toContain("[no impact identified]");
    expect(text).not.toContain("[notable change]");
    expect(text).toContain(
      "! requires action | kind tags: should know | plain: no impact identified",
    );
    expect(payload(report).statements?.items[0]?.classification).toMatchObject({
      tier: "no_impact",
      kind: "notable_change",
      ambiguous: true,
    });
  });
  it("keeps severity markers when the kind is absent, without inventing tags", () => {
    const report = evidence();
    report.statements!.items[0]!.classification!.kind = undefined;
    report.statements!.items[0]!.classification!.ambiguous = false;
    const text = formatPackageChangelogTerminal(payload(report), {
      useColors: false,
    });
    expect(text).toContain("* [!] Quoted statement 0");
    expect(text).toContain("* [should know] (uncertain) Quoted statement 1");
    expect(text).not.toContain("[requires action]");
    expect(text).toContain("[should know]");
  });
  it("colors confident action and should-know prefixes while keeping the same no-color meaning", () => {
    const report = evidence();
    report.statements!.items[0]!.classification!.ambiguous = false;
    report.statements!.items[1]!.classification!.ambiguous = false;
    report.statements!.items[1]!.classification!.kind =
      "DEPRECATES_WITHOUT_REMOVAL";
    const p = payload(report);
    const plain = formatPackageChangelogTerminal(p, { useColors: false });
    const colored = formatPackageChangelogTerminal(p, { useColors: true });
    expect(colored).toContain("\x1b[31m[!behavior]");
    expect(colored).toContain("\x1b[33m[deprecation]");
    expect(plain).toContain("* [deprecation] Quoted statement 1");
    expect(Bun.stripANSI(colored)).toBe(plain);
  });
  it("preserves structured evidence and null classification without mutating the service result", () => {
    const report = evidence();
    const p = payload(report);
    expect(p.entries.items[0]?.body).toBeUndefined();
    expect(p.statements?.count).toBe(5);
    expect(p.statements?.items[0]?.classification).toMatchObject({
      tier: "must_act",
      kind: "changes_behavior_or_default",
      ambiguous: true,
      tierConfidence: 0.95,
    });
    expect(p.statements?.items[4]?.classification).toBeNull();
    expect(p.statements?.items[3]?.context?.fullText).toBe(
      "Earlier uncut quote",
    );
    expect(report.statements?.items[0]?.classification?.tier).toBe("MUST_ACT");
    expect(p.statements?.coverage[0]?.status).toBe("not_assessed");
  });
  it.each(["actionable", "important"] as const)(
    "reports filtered pending and oversize exclusions with zero matches: %s",
    (changes) => {
      const report = evidence();
      report.statements!.items = [];
      report.statements!.matchingCount = 0;
      const text = formatPackageChangelogTerminal(payload(report, changes), {
        useColors: false,
      });
      expect(text).toContain("0 matching statements of 5 parsed");
      expect(text).toContain(
        "excludes 1 not-assessed and 1 too-long-to-classify",
      );
      expect(text).toContain("No statements match this filter");
      expect(text).toContain("Rerun");
    },
  );
  it("shows missing/unparseable coverage with zero units, never implying safe", () => {
    const report = evidence();
    report.statements!.items = [];
    report.statements!.totalCount = 0;
    report.statements!.matchingCount = 0;
    report.statements!.coverage = baseReport.entries.map((entry, index) => ({
      version: entry.version!,
      status: index === 0 ? "WITHOUT_NOTES" : "UNPARSEABLE",
      statementsTotal: 0,
      statementsAssessed: 0,
      statementsNotAssessed: 0,
      statementsNoImpact: 0,
      statementsUnclassified: 0,
    }));
    const text = formatPackageChangelogTerminal(payload(report), {
      useColors: false,
    });
    expect(text.replace(/\s+/g, " ")).toContain("1 without notes");
    expect(text).toContain("1 without parsed statements");
    expect(text).toContain("No release notes available");
    expect(text).toContain("Notes contain no parsed statements");
    expect(text).toContain("not evidence of no risk");
  });
  it("sanitizes every untrusted text field while leaving JSON evidence alone", () => {
    const report = evidence();
    report.entries[0]!.version = "5.2.1\x1b[31m";
    report.statements!.items.forEach((item) => {
      item.version = report.entries[0]!.version!;
      item.text += "\x1b[31mInjected\x1b[0m";
      item.heading = "Header\x1b[2J";
      item.url += "\x1b]0;evil\x07";
    });
    const p = payload(report);
    const text = formatPackageChangelogTerminal(p, {
      useColors: false,
      terminalWidth: 72,
    });
    expect(text).not.toContain("\x1b");
    expect(text).toContain("Injected");
    expect(p.statements?.items[0]?.text).toContain("\x1b");
  });
  it("wraps Express-style four-space continuations and nested bullets while preserving indented code", () => {
    const report = evidence();
    report.statements!.items[0]!.text = `- Fixed HTTP header conflict
    Fixed the behavior of res.send() ${"with explicit response headers ".repeat(15)}
    * IMPORTANT: ${"this default changes existing usage ".repeat(8)}

      example(  1, ${"argument, ".repeat(10)});`;
    const text = formatPackageChangelogTerminal(payload(report), {
      useColors: false,
      terminalWidth: 72,
    });
    expect(text).toContain("Fixed the behavior of res.send()");
    expect(text).toContain("* IMPORTANT:");
    expect(text).toContain(`example(  1, ${"argument, ".repeat(10)});`);
    for (const line of text.split("\n")) {
      if (!line.includes("example("))
        expect(line.length).toBeLessThanOrEqual(72);
    }
    expect(text).toContain("Context for next statement - Earlier");
  });
  it("preserves backend Unicode while formatter punctuation stays ASCII", () => {
    const report = evidence();
    report.statements!.items[0]!.text = "* α — 保留 …";
    const text = formatPackageChangelogTerminal(payload(report), {
      useColors: false,
    });
    expect(text).toContain("α — 保留 …");
    expect(text).toContain("[!behavior]");
  });
  it("wraps prose to caller width without truncating ordinary statements", () => {
    const report = evidence();
    report.statements!.items[0]!.text = `${"word ".repeat(110)}last word`;
    const text = formatPackageChangelogTerminal(payload(report), {
      useColors: false,
      terminalWidth: 72,
    });
    expect(text).toContain("last word");
    for (const line of text.split("\n"))
      expect(line.length).toBeLessThanOrEqual(72);
  });
  it("uses color only as an aid, and mutes uncertain labels", () => {
    const plain = formatPackageChangelogTerminal(payload(), {
      useColors: false,
    });
    const colored = formatPackageChangelogTerminal(payload(), {
      useColors: true,
    });
    expect(Bun.stripANSI(colored)).toBe(plain);
    expect(colored).toContain("\x1b[2m[!behavior]");
  });
  it("original-note view shows all lines unless the deprecated explicit cap is present", () => {
    const report = {
      ...baseReport,
      entries: [{ version: "1", body: "first\nsecond\nlast" }],
    };
    const p = buildPackageChangelogSuccessPayload(report, {
      ...baseOptions,
      view: "verbatim",
    });
    expect(formatPackageChangelogTerminal(p, { useColors: false })).toContain(
      "last",
    );
    expect(
      formatPackageChangelogTerminal(p, {
        useColors: false,
        bodyPreviewLines: 1,
      }),
    ).toContain("+2 more lines - use --verbatim");
    expect(p.statements).toBeUndefined();
  });
});
