import { describe, expect, it } from "bun:test";
import type { LeanListFilesEnvelope } from "./list-files-response.js";
import { renderListFilesText } from "./list-files-text.js";

function envelope(
  overrides: Partial<LeanListFilesEnvelope> = {},
): LeanListFilesEnvelope {
  return {
    registry: "npm",
    name: "express",
    indexedVersion: "v5.2.1",
    total: 2,
    hasMore: false,
    files: [
      { path: "src/index.js", language: "javascript", fileType: "SOURCE" },
      { path: "src/lib/app.js", language: "javascript", fileType: "SOURCE" },
    ],
    ...overrides,
  };
}

describe("renderListFilesText", () => {
  it("renders a paths-only listing with version-tagged identity", () => {
    const text = renderListFilesText(envelope());
    expect(text).toContain("code_files | 2 paths | npm:express@v5.2.1");
    expect(text).toContain("src/index.js");
    expect(text).toContain("src/lib/app.js");
    // No trailing metadata in default mode.
    expect(text).not.toContain("javascript");
    expect(text).not.toContain("SOURCE");
  });

  it("uses repo addressing when no registry is provided", () => {
    const text = renderListFilesText(
      envelope({
        registry: undefined,
        name: undefined,
        indexedVersion: undefined,
        repoUrl: "https://github.com/cline/cline",
        gitRef: "v3.4.2",
      }),
    );
    expect(text).toContain(
      "code_files | 2 paths | https://github.com/cline/cline@v3.4.2",
    );
  });

  it("emits a truncation hint with N+ count when hasMore", () => {
    const text = renderListFilesText(envelope({ hasMore: true, total: 2 }));
    expect(text).toContain("code_files | 2+ paths");
    expect(text).toContain("More files available.");
  });

  it("echoes explicit filter inputs in the header", () => {
    const text = renderListFilesText(
      envelope({
        filter: {
          path: "README.md",
          pathPrefix: "src/lib",
          globs: ["test/**/*.js"],
          extensions: ["js"],
          fileTypes: ["source"],
          languages: ["JavaScript"],
          fileIntent: "production",
          excludeDocFiles: true,
          includeHidden: true,
          limit: 50,
        },
      }),
    );
    expect(text).toContain(
      'path="README.md" path_prefix="src/lib" globs=test/**/*.js exts=js file_types=source languages=JavaScript file_intent=production exclude_doc_files=true include_hidden=true limit=50',
    );
  });

  it("renders the empty-result hint when no files match", () => {
    const text = renderListFilesText(
      envelope({
        files: [],
        total: 0,
        hint: "No files match this path prefix.",
      }),
    );
    expect(text).toContain("code_files | 0 paths");
    expect(text).toContain("No files match this path prefix.");
  });

  it("uses ASCII separators throughout", () => {
    const text = renderListFilesText(
      envelope({
        hasMore: true,
        filter: {
          pathPrefix: "src/",
          extensions: ["ts"],
          limit: 50,
        },
      }),
    );
    expect(text).not.toMatch(/[·…—–]/);
  });
});
