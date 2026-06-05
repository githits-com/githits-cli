import { describe, expect, it } from "bun:test";
import type { ReadFileResult } from "@githits/core-internal";
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
