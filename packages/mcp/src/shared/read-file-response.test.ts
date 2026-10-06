import { describe, expect, it } from "bun:test";
import type { ReadFileResult, TargetResolution } from "@githits/core-internal";
import {
  buildReadFileSuccessPayload,
  formatReadFileTerminal,
} from "./read-file-response.js";
import { renderReadFileText } from "./read-file-text.js";

const baseResult: ReadFileResult = {
  filePath: "src/index.js",
  language: "javascript",
  totalLines: 5,
  startLine: 1,
  endLine: 5,
  content:
    "// Express entry point\n'use strict';\n\nmodule.exports = require('./lib/express');\n",
  isBinary: false,
};

const baseOptions = {
  registry: "npm",
  name: "express",
  requestedFilePath: "src/index.js",
};

const repositoryUrl = "https://github.com/expressjs/express";
const servedSha = "1111111111111111111111111111111111111111";
const requestedSha = "2222222222222222222222222222222222222222";

function targetResolution(
  overrides: Partial<TargetResolution> = {},
): TargetResolution {
  return {
    availableVersions: [],
    availableRefs: [],
    ...overrides,
  };
}

function repositoryEstimate(
  commitSha: string = requestedSha,
): NonNullable<ReadFileResult["indexingEstimates"]>[number] {
  return {
    kind: "REPOSITORY",
    repositoryUrl,
    commitSha,
    targets: ["github:expressjs/express@HEAD"],
    estimate: { lowerSeconds: 100, upperSeconds: 120 },
  };
}

describe("buildReadFileSuccessPayload", () => {
  it("projects basic envelope shape", () => {
    const envelope = buildReadFileSuccessPayload(baseResult, baseOptions);
    expect(envelope.registry).toBe("npm");
    expect(envelope.name).toBe("express");
    expect(envelope.path).toBe("src/index.js");
    expect(envelope.language).toBe("javascript");
    expect(envelope.totalLines).toBe(5);
    expect(envelope.startLine).toBe(1);
    expect(envelope.endLine).toBe(5);
    expect(envelope.content).toContain("Express entry point");
    expect(envelope.isBinary).toBeUndefined();
  });

  it("falls back to requestedFilePath when the backend omits filePath (result-level)", () => {
    const envelope = buildReadFileSuccessPayload(
      { ...baseResult, filePath: undefined },
      baseOptions,
    );
    expect(envelope.path).toBe("src/index.js");
  });

  it("sets isBinary and omits content for binary files", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        filePath: "assets/logo.png",
        language: undefined,
        totalLines: undefined,
        startLine: undefined,
        endLine: undefined,
        content: undefined,
        isBinary: true,
      },
      { ...baseOptions, requestedFilePath: "assets/logo.png" },
    );
    expect(envelope.isBinary).toBe(true);
    expect(envelope.content).toBeUndefined();
  });

  it("surfaces repo-URL addressing when spec is absent", () => {
    const envelope = buildReadFileSuccessPayload(baseResult, {
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "main",
      requestedFilePath: "src/index.js",
    });
    expect(envelope.registry).toBeUndefined();
    expect(envelope.name).toBeUndefined();
    expect(envelope.repoUrl).toBe("https://github.com/expressjs/express");
    expect(envelope.gitRef).toBe("main");
  });

  it("strips per-field nulls", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        filePath: "src/index.js",
        language: undefined,
        totalLines: undefined,
        startLine: undefined,
        endLine: undefined,
        content: undefined,
        isBinary: false,
      },
      baseOptions,
    );
    expect(envelope.language).toBeUndefined();
    expect(envelope.totalLines).toBeUndefined();
    expect(envelope.startLine).toBeUndefined();
    expect(envelope.endLine).toBeUndefined();
    expect(envelope.content).toBeUndefined();
    expect(envelope.isBinary).toBeUndefined();
  });

  it("preserves empty-string content as distinct from absent", () => {
    const envelope = buildReadFileSuccessPayload(
      { ...baseResult, content: "" },
      baseOptions,
    );
    expect(envelope.content).toBe("");
  });

  it("does not auto-populate the hint field — that policy belongs to the MCP handler", () => {
    const wideResult: ReadFileResult = {
      filePath: "src/big.ts",
      language: "typescript",
      totalLines: 5000,
      startLine: 1,
      endLine: 5000,
      content: "// big file\n".repeat(5000),
      isBinary: false,
    };
    const envelope = buildReadFileSuccessPayload(wideResult, {
      ...baseOptions,
      requestedFilePath: "src/big.ts",
    });
    expect(envelope.hint).toBeUndefined();
  });
});

describe("formatReadFileTerminal", () => {
  it("plain mode: emits raw content only (no header, no gutter)", () => {
    const envelope = buildReadFileSuccessPayload(baseResult, baseOptions);
    const output = formatReadFileTerminal(envelope, { useColors: false });
    // Content is verbatim — no path header, no line numbers.
    expect(output).toBe(baseResult.content as string);
    expect(output).not.toContain("src/index.js · javascript");
    expect(output).not.toMatch(/^\s*1\s+\/\//m);
  });

  it("verbose mode: renders header + gutter + content", () => {
    const envelope = buildReadFileSuccessPayload(baseResult, baseOptions);
    const output = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("src/index.js · javascript · lines 1-5 of 5");
    expect(output).toContain("1  // Express entry point");
    expect(output).toContain("2  'use strict';");
  });

  it("verbose mode: preserves a trailing blank line when it is inside the returned range", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        filePath: "lib/application.js",
        language: "javascript",
        totalLines: 632,
        startLine: 33,
        endLine: 35,
        content:
          "var slice = Array.prototype.slice;\nvar flatten = Array.prototype.flat;\n",
        isBinary: false,
      },
      { ...baseOptions, requestedFilePath: "lib/application.js" },
    );
    const output = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("33  var slice = Array.prototype.slice;");
    expect(output).toContain("34  var flatten = Array.prototype.flat;");
    expect(output).toContain("35  \n");

    const text = renderReadFileText(envelope);
    expect(text.endsWith("35  ")).toBe(true);
  });

  it("verbose mode: drops only one trailing transport newline when range metadata is absent", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        filePath: "src/no-range.js",
        language: "javascript",
        content: "line 1\n\n",
        isBinary: false,
      },
      { ...baseOptions, requestedFilePath: "src/no-range.js" },
    );
    const output = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("1  line 1");
    expect(output).toContain("2  \n");
    expect(output).not.toContain("3  ");

    const text = renderReadFileText(envelope);
    expect(text).toContain("1  line 1");
    expect(text.endsWith("2  ")).toBe(true);
    expect(text).not.toContain("3  ");
  });

  it("plain mode: binary sentinel only — no header", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        filePath: "assets/logo.png",
        isBinary: true,
        content: undefined,
        language: undefined,
        totalLines: undefined,
        startLine: undefined,
        endLine: undefined,
      },
      { ...baseOptions, requestedFilePath: "assets/logo.png" },
    );
    const output = formatReadFileTerminal(envelope, { useColors: false });
    expect(output).toContain("Binary file — cannot display as text.");
    expect(output).not.toContain("assets/logo.png");
  });

  it("verbose mode: binary sentinel includes the header", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        filePath: "assets/logo.png",
        isBinary: true,
        content: undefined,
        language: undefined,
        totalLines: undefined,
        startLine: undefined,
        endLine: undefined,
      },
      { ...baseOptions, requestedFilePath: "assets/logo.png" },
    );
    const output = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("assets/logo.png");
    expect(output).toContain("Binary file — cannot display as text.");
  });

  it("verbose mode: omits language from header when missing", () => {
    const envelope = buildReadFileSuccessPayload(
      { ...baseResult, language: undefined },
      baseOptions,
    );
    const output = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).not.toContain("· undefined");
    expect(output).not.toContain("· null");
    expect(output).toContain("src/index.js");
  });

  it("verbose mode: renders a line-only range label when totalLines is absent", () => {
    const envelope = buildReadFileSuccessPayload(
      { ...baseResult, totalLines: undefined },
      baseOptions,
    );
    const output = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("lines 1-5");
    expect(output).not.toContain("of undefined");
  });

  it("verbose mode: pads the gutter to the widest line number in the slice", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        filePath: "src/big.js",
        language: "javascript",
        totalLines: 120,
        startLine: 95,
        endLine: 105,
        content: Array.from({ length: 11 }, (_, i) => `line ${i + 95}`).join(
          "\n",
        ),
        isBinary: false,
      },
      baseOptions,
    );
    const output = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    // Line numbers 95, 96, ..., 105 — widest is 3 digits. Expect
    // right-aligned width.
    expect(output).toContain(" 95  line 95");
    expect(output).toContain("105  line 105");
  });

  it("plain mode: preserves empty-string content verbatim", () => {
    const envelope = buildReadFileSuccessPayload(
      { ...baseResult, content: "" },
      baseOptions,
    );
    const output = formatReadFileTerminal(envelope, { useColors: false });
    expect(output).toBe("");
  });

  it("verbose mode: empty content renders header with no gutter rows", () => {
    const envelope = buildReadFileSuccessPayload(
      { ...baseResult, content: "" },
      baseOptions,
    );
    const output = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    expect(output).toContain("src/index.js");
    expect(output).not.toContain("1  ");
  });
});

describe("read refresh metadata", () => {
  it("separates pending preparation from readable content and keeps raw CLI content unchanged", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        ...baseResult,
        indexingEstimates: [
          {
            kind: "REPOSITORY",
            targets: ["npm:express@1.0.3"],
            estimate: { lowerSeconds: 33, upperSeconds: 85 },
          },
        ],
      },
      baseOptions,
    );
    const mcp = renderReadFileText(envelope);
    const verbose = formatReadFileTerminal(envelope, {
      useColors: false,
      verbose: true,
    });
    for (const text of [mcp, verbose]) {
      expect(text).toContain("\n\nPreparing:\n  - npm:express@1.0.3");
      expect(text).toContain("module.exports");
    }
    expect(formatReadFileTerminal(envelope, { useColors: false })).toBe(
      baseResult.content!,
    );
  });
});

describe("read source rows", () => {
  it("renders a dated current source before MCP and verbose CLI content", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        ...baseResult,
        targetResolution: targetResolution({
          requested: {
            kind: "repo_tag",
            repoUrl: repositoryUrl,
            gitRef: "v1.0.0",
          },
          resolvedRequested: {
            kind: "repo_tag",
            repoUrl: repositoryUrl,
            gitRef: "v1.0.0",
            commitSha: servedSha,
            committedAt: "2099-12-31T23:59:59Z",
          },
          served: {
            kind: "repo_tag",
            repoUrl: repositoryUrl,
            gitRef: "v1.0.0",
            commitSha: servedSha,
            committedAt: "2099-12-31T23:59:59Z",
          },
          freshness: "current",
          freshnessReason: "exact_current",
        }),
      },
      baseOptions,
    );
    const row =
      "  - github:expressjs/express@11111111 (committed 2099-12-31, indexed from ref v1.0.0)";
    const body = [
      "1  // Express entry point",
      "2  'use strict';",
      "3  ",
      "4  module.exports = require('./lib/express');",
      "5  ",
    ];

    expect(renderReadFileText(envelope, { width: 200 })).toBe(
      [
        "read | src/index.js | javascript | lines 1-5/5",
        "Sources:",
        row,
        "",
        ...body,
      ].join("\n"),
    );
    expect(
      formatReadFileTerminal(envelope, {
        useColors: false,
        verbose: true,
        width: 200,
      }),
    ).toBe(
      [
        "src/index.js · javascript · lines 1-5 of 5",
        "Sources:",
        row,
        "",
        ...body,
        "",
      ].join("\n"),
    );
    expect(renderReadFileText(envelope)).not.toContain("Preparing:");
    expect(
      formatReadFileTerminal(envelope, { useColors: false, verbose: true }),
    ).not.toContain("Requested:");
  });

  it("keeps same-ref requested work and recovery after content on both surfaces", () => {
    const envelope = buildReadFileSuccessPayload(
      {
        ...baseResult,
        totalLines: 1,
        startLine: 1,
        endLine: 1,
        content: "const value = 1;",
        indexingEstimates: [repositoryEstimate()],
        targetResolution: targetResolution({
          requested: {
            kind: "repo_head",
            repoUrl: repositoryUrl,
            gitRef: "HEAD",
            commitSha: requestedSha,
          },
          resolvedRequested: {
            kind: "repo_head",
            repoUrl: repositoryUrl,
            gitRef: "HEAD",
            commitSha: requestedSha,
            committedAt: "2026-01-02T03:04:05Z",
          },
          served: {
            kind: "repo_head",
            repoUrl: repositoryUrl,
            gitRef: "HEAD",
            commitSha: servedSha,
            committedAt: "2025-12-31T23:59:59Z",
          },
          freshness: "fallback_recent",
          freshnessReason: "requested_ref_indexing",
          availableRefs: [{ ref: "main" }],
          suggestedRefs: [{ ref: "candidate" }],
        }),
      },
      baseOptions,
    );
    const sourceRow =
      "  - github:expressjs/express@11111111 (committed 2025-12-31, indexed from ref HEAD, older snapshot)";
    const preparationRow =
      "  - github:expressjs/express@22222222 (indexing, estimated total: 100-120s, committed 2026-01-02, observed HEAD)";

    for (const text of [
      renderReadFileText(envelope, { width: 200 }),
      formatReadFileTerminal(envelope, {
        useColors: false,
        verbose: true,
        width: 200,
      }),
    ]) {
      expect(text).toContain(sourceRow);
      expect(text).toContain(preparationRow);
      expect(text).toContain("queryable now: refs=main");
      expect(text).toContain("suggested refs (may need indexing): candidate");
      expect(text.indexOf(sourceRow)).toBeLessThan(
        text.indexOf("const value = 1;"),
      );
      expect(text.indexOf("const value = 1;")).toBeLessThan(
        text.indexOf("Preparing:"),
      );
      expect(text.indexOf("Preparing:")).toBeLessThan(
        text.indexOf("queryable now: refs=main"),
      );
    }
  });

  it("retains sources, preparation, and recovery on verbose binary and no-content paths", () => {
    const provenance = targetResolution({
      requested: {
        kind: "repo_head",
        repoUrl: repositoryUrl,
        gitRef: "HEAD",
        commitSha: requestedSha,
      },
      resolvedRequested: {
        kind: "repo_head",
        repoUrl: repositoryUrl,
        gitRef: "HEAD",
        commitSha: requestedSha,
        committedAt: "2026-01-02T03:04:05Z",
      },
      served: {
        kind: "repo_head",
        repoUrl: repositoryUrl,
        gitRef: "HEAD",
        commitSha: servedSha,
        committedAt: "2025-12-31T23:59:59Z",
      },
      freshness: "fallback_recent",
      freshnessReason: "requested_ref_indexing",
      availableRefs: [{ ref: "main" }],
      suggestedRefs: [{ ref: "candidate" }],
    });
    const binaryEnvelope = buildReadFileSuccessPayload(
      {
        filePath: "assets/logo.png",
        language: undefined,
        totalLines: undefined,
        startLine: undefined,
        endLine: undefined,
        content: undefined,
        isBinary: true,
        indexingEstimates: [repositoryEstimate()],
        targetResolution: provenance,
      },
      {
        ...baseOptions,
        repoUrl: repositoryUrl,
        gitRef: "HEAD",
        requestedFilePath: "assets/logo.png",
      },
    );
    const emptyEnvelope = buildReadFileSuccessPayload(
      {
        filePath: "src/empty.js",
        language: undefined,
        totalLines: undefined,
        startLine: undefined,
        endLine: undefined,
        content: undefined,
        isBinary: false,
        indexingEstimates: [repositoryEstimate()],
        targetResolution: provenance,
      },
      {
        ...baseOptions,
        repoUrl: repositoryUrl,
        gitRef: "HEAD",
        requestedFilePath: "src/empty.js",
      },
    );

    for (const { envelope, cliSentinel, mcpSentinel } of [
      {
        envelope: binaryEnvelope,
        cliSentinel: "Binary file — cannot display as text.",
        mcpSentinel: "Binary file - cannot display as text.",
      },
      {
        envelope: emptyEnvelope,
        cliSentinel: "(no content returned)",
        mcpSentinel: "(no content returned)",
      },
    ]) {
      const cli = formatReadFileTerminal(envelope, {
        useColors: false,
        verbose: true,
        width: 200,
      });
      const mcp = renderReadFileText(envelope, { width: 200 });
      for (const [text, sentinel] of [
        [cli, cliSentinel],
        [mcp, mcpSentinel],
      ] as const) {
        expect(text.indexOf("Sources:")).toBeLessThan(text.indexOf(sentinel));
        expect(text.indexOf(sentinel)).toBeLessThan(text.indexOf("Preparing:"));
        expect(text.indexOf("Preparing:")).toBeLessThan(
          text.indexOf("queryable now: refs=main"),
        );
        expect(text).toContain("suggested refs (may need indexing): candidate");
      }
    }

    expect(formatReadFileTerminal(binaryEnvelope, { useColors: false })).toBe(
      "Binary file — cannot display as text.\n",
    );
    expect(formatReadFileTerminal(emptyEnvelope, { useColors: false })).toBe(
      "(no content returned)\n",
    );
  });

  it("preserves raw content bytes with provenance supplied", () => {
    const content = "const value = 1;\n";
    const envelope = buildReadFileSuccessPayload(
      {
        ...baseResult,
        content,
        targetResolution: targetResolution({
          served: {
            repoUrl: repositoryUrl,
            gitRef: "main",
            commitSha: servedSha,
            committedAt: "2099-12-31T23:59:59Z",
          },
          freshness: "current",
          freshnessReason: "exact_current",
        }),
      },
      baseOptions,
    );

    expect(formatReadFileTerminal(envelope, { useColors: false })).toBe(
      content,
    );
  });

  it("keeps deferred and unknown resolution notes without inventing Sources", () => {
    const requested = {
      kind: "repo_head",
      repoUrl: repositoryUrl,
      gitRef: "HEAD",
      commitSha: requestedSha,
    };
    const resolvedRequested = {
      ...requested,
      committedAt: "2026-01-02T03:04:05Z",
    };
    const unavailable = buildReadFileSuccessPayload(
      {
        ...baseResult,
        targetResolution: targetResolution({
          requested,
          resolvedRequested,
          freshness: "unavailable",
          freshnessReason: "ref_resolution_deferred",
          availableRefs: [{ ref: "main" }],
        }),
      },
      { ...baseOptions, repoUrl: repositoryUrl, gitRef: "HEAD" },
    );
    const unknown = buildReadFileSuccessPayload(
      {
        ...baseResult,
        targetResolution: targetResolution({
          requested,
          resolvedRequested,
          freshness: "future_state",
          freshnessReason: "future_reason",
          availableRefs: [{ ref: "main" }],
        }),
      },
      { ...baseOptions, repoUrl: repositoryUrl, gitRef: "HEAD" },
    );

    for (const envelope of [unavailable, unknown]) {
      const texts = [
        renderReadFileText(envelope),
        formatReadFileTerminal(envelope, { useColors: false, verbose: true }),
      ];
      for (const text of texts) expect(text).not.toContain("Sources:");
      expect(texts[0]).toContain(
        "Requested: github:expressjs/express@22222222",
      );
      expect(texts[0]).toContain("queryable now: refs=main");
    }
    const unavailableMcp = renderReadFileText(unavailable);
    expect(unavailableMcp).toContain("Target unavailable.");
    expect(unavailableMcp).toContain("Branch resolution is deferred.");
    const unknownMcp = renderReadFileText(unknown);
    expect(unknownMcp).toContain(
      "Resolution state: future_state; reason: future_reason",
    );
  });
});
