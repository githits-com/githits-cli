import { describe, expect, it } from "bun:test";
import { parseCodeNavigationTargetSpec } from "./code-navigation-target.js";
import type { LeanListFilesEnvelope } from "./list-files-response.js";
import { renderListFilesText } from "./list-files-text.js";

function envelope(
  overrides: Partial<LeanListFilesEnvelope> = {},
): LeanListFilesEnvelope {
  return {
    registry: "npm",
    name: "express",
    indexedVersion: "v5.2.1",
    resolution: { requestedVersion: "5.2.1" },
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
    expect(text).toContain("code_files | 2 paths | npm:express@5.2.1");
    expect(text).toContain("src/index.js");
    expect(text).toContain("src/lib/app.js");
    // No trailing metadata in default mode.
    expect(text).not.toContain("javascript");
    expect(text).not.toContain("SOURCE");
  });

  it("emits the served repository commit as a reusable read target", () => {
    const commit = "dbac741a49a5a64336b70c06e85c2e2706e36336";
    const text = renderListFilesText(
      envelope({
        indexedVersion: commit,
        resolution: { resolvedRef: commit, commitSha: commit },
        targetResolution: {
          served: {
            repoUrl: "https://github.com/expressjs/express",
            gitRef: "v5.2.1",
            commitSha: commit,
            version: "5.2.1",
          },
          freshness: "current",
          availableVersions: [],
          availableRefs: [],
        },
      }),
    );
    expect(text).toContain(
      `code_files | 2 paths | github:expressjs/express#${commit}`,
    );
    expect(text).not.toContain(`npm:express@${commit}`);
    expect(text).not.toContain(`#v5.2.1@`);
    expect(
      parseCodeNavigationTargetSpec(text.split(" | ")[2]!.split("\n")[0]!),
    ).toEqual({
      repoUrl: "https://github.com/expressjs/express",
      gitRef: commit,
    });
  });

  it("does not turn an untyped indexed Git ref into a package version", () => {
    const text = renderListFilesText(
      envelope({
        indexedVersion: "dbac741a49a5a64336b70c06e85c2e2706e36336",
        resolution: { resolvedRef: "main" },
      }),
    );
    expect(text.split("\n")[0]).toBe("code_files | 2 paths | npm:express");
  });

  it("keeps a served package version ahead of the requested version", () => {
    const text = renderListFilesText(
      envelope({
        resolution: { requestedVersion: "5.2.1" },
        targetResolution: {
          served: { registry: "npm", packageName: "express", version: "5.1.0" },
          availableVersions: [],
          availableRefs: [],
        },
      }),
    );
    expect(text.split("\n")[0]).toBe(
      "code_files | 2 paths | npm:express@5.1.0",
    );
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
    expect(text).toContain("code_files | 2 paths | github:cline/cline#v3.4.2");
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
