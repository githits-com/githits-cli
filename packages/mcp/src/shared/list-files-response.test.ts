import { describe, expect, it } from "bun:test";
import type { ListFilesResult } from "@githits/core-internal";
import {
  buildListFilesSuccessPayload,
  formatListFilesTerminal,
} from "./list-files-response.js";

const baseResult: ListFilesResult = {
  files: [
    {
      path: "src/index.js",
      name: "index.js",
      language: "javascript",
      fileType: "SOURCE",
      byteSize: 1234,
    },
    {
      path: "src/lib/app.js",
      name: "app.js",
      language: "javascript",
      fileType: "SOURCE",
      byteSize: 8500,
    },
  ],
  total: 2,
  hasMore: false,
  indexedVersion: "v5.2.1",
  resolution: {
    requestedVersion: undefined,
    requestedRef: undefined,
    resolvedRef: "v5.2.1",
    commitSha: "abc123def456",
  },
  hint: undefined,
};

const baseOptions = {
  registry: "npm",
  name: "express",
  explicit: {
    path: false,
    pathPrefix: false,
    globs: false,
    extensions: false,
    fileTypes: false,
    languages: false,
    fileIntent: false,
    fileIntents: false,
    excludeFileIntents: false,
    excludeDocFiles: false,
    excludeTestFiles: false,
    includeHidden: false,
    limit: false,
  },
};

describe("buildListFilesSuccessPayload", () => {
  it("projects the basic envelope shape for spec addressing", () => {
    const envelope = buildListFilesSuccessPayload(baseResult, baseOptions);
    expect(envelope.registry).toBe("npm");
    expect(envelope.name).toBe("express");
    expect(envelope.repoUrl).toBeUndefined();
    expect(envelope.total).toBe(2);
    expect(envelope.hasMore).toBe(false);
    expect(envelope.files.length).toBe(2);
    expect(envelope.files[0]).toEqual({
      path: "src/index.js",
      name: "index.js",
      language: "javascript",
      fileType: "SOURCE",
      byteSize: 1234,
    });
    expect(envelope.indexedVersion).toBe("v5.2.1");
    expect(envelope.resolution).toEqual({
      resolvedRef: "v5.2.1",
      commitSha: "abc123def456",
    });
    expect(envelope.filter).toBeUndefined();
    expect(envelope.hint).toBeUndefined();
  });

  it("emits filter.limit only when the caller supplied it explicitly", () => {
    const withoutFilter = buildListFilesSuccessPayload(baseResult, baseOptions);
    expect(withoutFilter.filter).toBeUndefined();

    const withFilter = buildListFilesSuccessPayload(baseResult, {
      ...baseOptions,
      limit: 100,
      explicit: { ...baseOptions.explicit, limit: true },
    });
    expect(withFilter.filter).toEqual({ limit: 100 });
  });

  it("echoes pathPrefix in filter only when explicit", () => {
    const envelope = buildListFilesSuccessPayload(baseResult, {
      ...baseOptions,
      pathPrefix: "src/",
      explicit: { ...baseOptions.explicit, pathPrefix: true },
    });
    expect(envelope.filter).toEqual({ pathPrefix: "src/" });
  });

  it("echoes advanced filters only when explicit", () => {
    const envelope = buildListFilesSuccessPayload(baseResult, {
      ...baseOptions,
      path: "README.md",
      globs: ["test/**/*.js"],
      extensions: ["js"],
      fileTypes: ["source"],
      languages: ["JavaScript"],
      fileIntents: ["production", "test"],
      excludeFileIntents: ["generated"],
      excludeDocFiles: true,
      includeHidden: true,
      explicit: {
        ...baseOptions.explicit,
        path: true,
        globs: true,
        extensions: true,
        fileTypes: true,
        languages: true,
        fileIntents: true,
        excludeFileIntents: true,
        excludeDocFiles: true,
        includeHidden: true,
      },
    });
    expect(envelope.filter).toEqual({
      path: "README.md",
      globs: ["test/**/*.js"],
      extensions: ["js"],
      fileTypes: ["source"],
      languages: ["JavaScript"],
      fileIntents: ["production", "test"],
      excludeFileIntents: ["generated"],
      excludeDocFiles: true,
      includeHidden: true,
    });
  });

  it("emits repoUrl + gitRef for repo-URL addressing", () => {
    const envelope = buildListFilesSuccessPayload(baseResult, {
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "main",
      explicit: baseOptions.explicit,
    });
    expect(envelope.registry).toBeUndefined();
    expect(envelope.name).toBeUndefined();
    expect(envelope.repoUrl).toBe("https://github.com/expressjs/express");
    expect(envelope.gitRef).toBe("main");
  });

  it("emits hint when the backend supplied one", () => {
    const envelope = buildListFilesSuccessPayload(
      { ...baseResult, files: [], total: 0, hint: "No files match src/foo/" },
      baseOptions,
    );
    expect(envelope.files).toEqual([]);
    expect(envelope.total).toBe(0);
    expect(envelope.hint).toBe("No files match src/foo/");
  });

  it("strips null per-entry fields", () => {
    const envelope = buildListFilesSuccessPayload(
      {
        ...baseResult,
        files: [
          {
            path: "src/only-path.txt",
            name: undefined,
            language: undefined,
            fileType: undefined,
            byteSize: undefined,
          },
        ],
      },
      baseOptions,
    );
    expect(envelope.files[0]).toEqual({ path: "src/only-path.txt" });
  });
});

describe("formatListFilesTerminal", () => {
  it("plain mode: stdout is bare paths only — no header, no classification", () => {
    const envelope = buildListFilesSuccessPayload(baseResult, baseOptions);
    const { stdout, stderr } = formatListFilesTerminal(envelope, {
      useColors: false,
    });
    expect(stdout).toContain("src/index.js");
    expect(stdout).toContain("src/lib/app.js");
    // Header and resolution context are verbose-only.
    expect(stdout).not.toContain("express · npm");
    expect(stdout).not.toContain("indexed at v5.2.1");
    // Classification annotations are verbose-only.
    expect(stdout).not.toContain("javascript");
    expect(stdout).not.toContain("SOURCE");
    expect(stdout).not.toContain("KB");
    // No stderr under happy-path plain mode.
    expect(stderr).toBeUndefined();
  });

  it("verbose mode: stdout carries header + classification annotations alongside paths", () => {
    const envelope = buildListFilesSuccessPayload(baseResult, baseOptions);
    const { stdout } = formatListFilesTerminal(envelope, {
      verbose: true,
      useColors: false,
    });
    expect(stdout).toContain("express · npm");
    expect(stdout).toContain("2 files");
    expect(stdout).toContain("indexed at v5.2.1");
    expect(stdout).toContain("commit abc123d");
    expect(stdout).toContain("src/index.js");
    expect(stdout).toContain("javascript");
    expect(stdout).toContain("1.2 KB");
    expect(stdout).toContain("8.3 KB");
  });

  it("verbose mode: aligns annotations by terminal-cell width", () => {
    const envelope = buildListFilesSuccessPayload(
      {
        ...baseResult,
        files: [
          { path: "한", language: "text" },
          { path: "longer", language: "text" },
        ],
        total: 2,
      },
      baseOptions,
    );
    const { stdout } = formatListFilesTerminal(envelope, {
      verbose: true,
      useColors: false,
    });

    expect(stdout).toContain("한      · text\nlonger  · text");
  });

  it("verbose mode: uses the canonical repo target as identity for repo addressing", () => {
    const envelope = buildListFilesSuccessPayload(baseResult, {
      ...baseOptions,
      registry: undefined,
      name: undefined,
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "main",
    });
    const { stdout } = formatListFilesTerminal(envelope, {
      verbose: true,
      useColors: false,
    });
    expect(stdout).toContain("github:expressjs/express#main");
  });

  it("plain mode hasMore: stdout stays clean; warning goes to stderr", () => {
    const envelope = buildListFilesSuccessPayload(
      { ...baseResult, total: 200, hasMore: true },
      {
        ...baseOptions,
        limit: 200,
        explicit: { ...baseOptions.explicit, limit: true },
      },
    );
    const { stdout, stderr } = formatListFilesTerminal(envelope, {
      useColors: false,
    });
    // stdout carries only paths — no truncation warning to poison pipes.
    expect(stdout).not.toContain("More files available");
    expect(stdout).not.toContain("2+ files");
    // stderr carries the human-facing warning.
    expect(stderr).toContain("More files available");
    expect(stderr).toContain("pass --limit higher");
  });

  it("verbose mode hasMore: truncation warning included inline", () => {
    const envelope = buildListFilesSuccessPayload(
      { ...baseResult, total: 200, hasMore: true },
      {
        ...baseOptions,
        limit: 200,
        explicit: { ...baseOptions.explicit, limit: true },
      },
    );
    const { stdout } = formatListFilesTerminal(envelope, {
      verbose: true,
      useColors: false,
    });
    // Backend `total` is capped to the returned count when hasMore is
    // true — surface as "N+" so the truncation is obvious.
    expect(stdout).toContain("2+ files");
    expect(stdout).toContain("More files available");
  });

  it("plain mode empty: stdout silent; hint on stderr", () => {
    const envelope = buildListFilesSuccessPayload(
      { ...baseResult, files: [], total: 0, hint: "No files match src/foo/" },
      baseOptions,
    );
    const { stdout, stderr } = formatListFilesTerminal(envelope, {
      useColors: false,
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("No files match src/foo/");
  });

  it("verbose mode empty: hint rendered inline under header", () => {
    const envelope = buildListFilesSuccessPayload(
      { ...baseResult, files: [], total: 0, hint: "No files match src/foo/" },
      baseOptions,
    );
    const { stdout } = formatListFilesTerminal(envelope, {
      verbose: true,
      useColors: false,
    });
    expect(stdout).toContain("express · npm");
    expect(stdout).toContain("No files match src/foo/");
  });

  it("plain mode empty without hint: stderr carries fallback message", () => {
    const envelope = buildListFilesSuccessPayload(
      { ...baseResult, files: [], total: 0 },
      baseOptions,
    );
    const { stdout, stderr } = formatListFilesTerminal(envelope, {
      useColors: false,
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("No files match");
  });
});
