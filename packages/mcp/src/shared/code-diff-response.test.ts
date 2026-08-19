import { describe, expect, it } from "bun:test";
import type { CodeDiffParams, CodeDiffResult } from "@githits/core-internal";
import {
  type BuildCodeDiffPayloadOptions,
  buildCodeDiffSuccessPayload,
} from "./code-diff-response.js";

const packageTarget: CodeDiffParams["target"] = {
  registry: "NPM",
  packageName: "request-package",
};

const repositoryTarget: CodeDiffParams["target"] = {
  repoUrl: "https://github.com/example/repository",
};

function makeResult(): CodeDiffResult {
  return {
    package: {
      registry: "PYPI",
      name: "canonical-package",
      repoUrl: "https://github.com/example/canonical-package",
    },
    fromResolution: {
      requested: "  from  ",
      resolvedVersion: "1.0.0",
      ref: "refs/tags/v1.0.0",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      refKind: "TAG",
      versionSource: "REGISTRY",
    },
    toResolution: {
      requested: "to-ref",
      resolvedVersion: undefined,
      ref: "to-ref",
      commitSha: "fedcba9876543210fedcba9876543210fedcba98",
      refKind: "HEAD",
      versionSource: "GIT_HEAD",
    },
    raw: {
      summary: {
        filesChanged: 8,
        added: 3,
        deleted: 2,
        modified: 3,
        modeChanged: 1,
        typeChanged: 2,
        inventoryComplete: false,
        unprojectableFiles: 1,
      },
      scope: {
        status: "PACKAGE",
        fromSubpath: "",
        toSubpath: "",
        pathPrefix: "src",
        pathGlob: "src/**/*.ts",
      },
      contentCoverage: "PARTIAL",
      contentFailure: undefined,
      files: [
        {
          path: "first\\x80.ts",
          pathEncoding: "BYTE_ESCAPED",
          status: "ADDED",
          modeChanged: true,
          typeChanged: true,
          additions: 0,
          deletions: 2,
          contentStatus: "OMITTED",
          contentOmissionReason: "invalid_utf8",
          contentSafety: {
            filtered: true,
            modifications: ["HTML_COMMENTS_STRIPPED", "IMAGES_REPLACED"],
          },
        },
        {
          path: "second.ts",
          pathEncoding: "UTF8",
          status: "MODIFIED",
          modeChanged: false,
          typeChanged: false,
          additions: 4,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+new",
          contentStatus: "PATCH",
          contentSafety: { filtered: false, modifications: [] },
        },
      ],
      hasMoreFiles: true,
    },
  };
}

function options(
  target: CodeDiffParams["target"] = packageTarget,
  view: BuildCodeDiffPayloadOptions["view"] = "patch",
): BuildCodeDiffPayloadOptions {
  return { target, view };
}

describe("buildCodeDiffSuccessPayload", () => {
  it("uses canonical package facts and omits opposite target keys", () => {
    const payload = buildCodeDiffSuccessPayload(
      makeResult(),
      options(packageTarget, "name-only"),
    );

    expect(payload.target).toEqual({
      kind: "package",
      registry: "pypi",
      name: "canonical-package",
      repoUrl: "https://github.com/example/canonical-package",
    });
    expect(Object.keys(payload.target)).toEqual([
      "kind",
      "registry",
      "name",
      "repoUrl",
    ]);
    expect(Object.hasOwn(payload.target, "repoUrl")).toBe(true);
    expect(Object.hasOwn(payload.target, "gitRef")).toBe(false);
  });

  it("uses normalized package facts when the result has no package", () => {
    const result = makeResult();
    result.package = undefined;
    const payload = buildCodeDiffSuccessPayload(result, options());

    expect(payload.target).toEqual({
      kind: "package",
      registry: "npm",
      name: "request-package",
    });
    expect(Object.keys(payload.target)).toEqual(["kind", "registry", "name"]);
    expect(Object.hasOwn(payload.target, "repoUrl")).toBe(false);
  });

  it("projects repository targets without package-shaped keys", () => {
    const payload = buildCodeDiffSuccessPayload(
      makeResult(),
      options(repositoryTarget, "name-status"),
    );

    expect(payload.target).toEqual({
      kind: "repository",
      repoUrl: "https://github.com/example/repository",
    });
    expect(Object.keys(payload.target)).toEqual(["kind", "repoUrl"]);
    expect(Object.hasOwn(payload.target, "registry")).toBe(false);
    expect(Object.hasOwn(payload.target, "name")).toBe(false);
  });

  it("preserves full resolution identity and lowercases enum values", () => {
    const payload = buildCodeDiffSuccessPayload(
      makeResult(),
      options(packageTarget, "name-only"),
    );

    expect(payload.from).toEqual({
      requested: "  from  ",
      resolvedVersion: "1.0.0",
      ref: "refs/tags/v1.0.0",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      refKind: "tag",
      versionSource: "registry",
    });
    expect(payload.to).toEqual({
      requested: "to-ref",
      ref: "to-ref",
      commitSha: "fedcba9876543210fedcba9876543210fedcba98",
      refKind: "head",
      versionSource: "git_head",
    });
    expect(Object.hasOwn(payload.to, "resolvedVersion")).toBe(false);
  });

  it("preserves summary, legacy package scope, truncation, and coverage facts", () => {
    const payload = buildCodeDiffSuccessPayload(
      makeResult(),
      options(packageTarget, "name-only"),
    );

    expect(payload.summary).toEqual({
      filesChanged: 8,
      added: 3,
      deleted: 2,
      modified: 3,
      modeChanged: 1,
      typeChanged: 2,
      inventoryComplete: false,
      unprojectableFiles: 1,
    });
    expect(payload.scope).toEqual({
      status: "package",
      fromSubpath: "",
      toSubpath: "",
      pathPrefix: "src",
      pathGlob: "src/**/*.ts",
    });
    expect(payload.contentCoverage).toBe("partial");
    expect(payload.hasMoreFiles).toBe(true);
    expect(payload.files.map((file) => file.path)).toEqual([
      "first\\x80.ts",
      "second.ts",
    ]);
  });

  it("preserves different package roots on each comparison side", () => {
    const result = makeResult();
    result.raw.scope = {
      status: "PACKAGE",
      fromSubpath: "packages/old-name",
      toSubpath: "packages/new-name",
    };

    const payload = buildCodeDiffSuccessPayload(
      result,
      options(packageTarget, "name-only"),
    );

    expect(payload.scope).toEqual({
      status: "package",
      fromSubpath: "packages/old-name",
      toSubpath: "packages/new-name",
    });
  });

  it("projects name-only with mandatory path encoding and no other fields", () => {
    const payload = buildCodeDiffSuccessPayload(
      makeResult(),
      options(packageTarget, "name-only"),
    );

    expect(payload.files).toEqual([
      { path: "first\\x80.ts", pathEncoding: "byte_escaped" },
      { path: "second.ts", pathEncoding: "utf8" },
    ]);
  });

  it("projects name-status with lowercase status only", () => {
    const payload = buildCodeDiffSuccessPayload(
      makeResult(),
      options(packageTarget, "name-status"),
    );

    expect(payload.files).toEqual([
      {
        path: "first\\x80.ts",
        pathEncoding: "byte_escaped",
        status: "added",
      },
      { path: "second.ts", pathEncoding: "utf8", status: "modified" },
    ]);
  });

  it("projects stat facts and omits patch-only fields", () => {
    const result = makeResult();
    for (const file of result.raw.files) {
      file.contentStatus = "STATS";
      file.patch = undefined;
      file.contentOmissionReason = undefined;
    }
    const payload = buildCodeDiffSuccessPayload(
      result,
      options(packageTarget, "stat"),
    );

    expect(payload.files).toEqual([
      {
        path: "first\\x80.ts",
        pathEncoding: "byte_escaped",
        status: "added",
        modeChanged: true,
        typeChanged: true,
        additions: 0,
        deletions: 2,
        contentStatus: "stats",
      },
      {
        path: "second.ts",
        pathEncoding: "utf8",
        status: "modified",
        modeChanged: false,
        typeChanged: false,
        additions: 4,
        deletions: 1,
        contentStatus: "stats",
      },
    ]);
    expect(Object.hasOwn(payload.files[0]!, "patch")).toBe(false);
    expect(Object.hasOwn(payload.files[0]!, "contentSafety")).toBe(false);
  });

  it("projects realistic patch and omission facts with safety", () => {
    const payload = buildCodeDiffSuccessPayload(
      makeResult(),
      options(packageTarget, "patch"),
    );

    expect(payload.files).toEqual([
      {
        path: "first\\x80.ts",
        pathEncoding: "byte_escaped",
        status: "added",
        modeChanged: true,
        typeChanged: true,
        additions: 0,
        deletions: 2,
        contentStatus: "omitted",
        contentOmissionReason: "invalid_utf8",
        contentSafety: {
          filtered: true,
          modifications: ["html_comments_stripped", "images_replaced"],
        },
      },
      {
        path: "second.ts",
        pathEncoding: "utf8",
        status: "modified",
        modeChanged: false,
        typeChanged: false,
        additions: 4,
        deletions: 1,
        contentStatus: "patch",
        patch: "@@ -1 +1 @@\n-old\n+new",
        contentSafety: { filtered: false, modifications: [] },
      },
    ]);
  });

  it("binds placeholder patch headers to Git-quoted authoritative paths", () => {
    const result = makeResult();
    result.raw.files = [
      {
        path: "src/line\nname.ts",
        pathEncoding: "UTF8",
        status: "MODIFIED",
        modeChanged: false,
        typeChanged: false,
        additions: 1,
        deletions: 1,
        patch: "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n",
        contentStatus: "PATCH",
        contentSafety: { filtered: false, modifications: [] },
      },
      {
        path: "added file.ts",
        pathEncoding: "UTF8",
        status: "ADDED",
        modeChanged: false,
        typeChanged: false,
        additions: 1,
        deletions: 0,
        patch: "--- /dev/null\n+++ b/file\n@@ -0,0 +1 @@\n+new\n",
        contentStatus: "PATCH",
        contentSafety: { filtered: false, modifications: [] },
      },
      {
        path: "deleted.ts",
        pathEncoding: "UTF8",
        status: "DELETED",
        modeChanged: false,
        typeChanged: false,
        additions: 0,
        deletions: 1,
        patch: "--- a/file\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
        contentStatus: "PATCH",
        contentSafety: { filtered: false, modifications: [] },
      },
    ];

    const payload = buildCodeDiffSuccessPayload(result, options());

    expect(
      payload.files.map((file) => ("patch" in file ? file.patch : null)),
    ).toEqual([
      '--- "a/src/line\\012name.ts"\n+++ "b/src/line\\012name.ts"\n@@ -1 +1 @@\n-old\n+new\n',
      "--- /dev/null\n+++ b/added file.ts\n@@ -0,0 +1 @@\n+new\n",
      "--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
    ]);
  });

  it("preserves upstream patches whose headers are already authoritative", () => {
    const result = makeResult();
    const file = result.raw.files[1];
    if (!file) throw new Error("Expected second fixture file.");
    file.patch = "--- a/second.ts\n+++ b/second.ts\n@@ -1 +1 @@\n-old\n+new\n";

    const payload = buildCodeDiffSuccessPayload(result, options());

    expect(payload.files[1]).toMatchObject({ patch: file.patch });
  });

  it("preserves content failure fields for failed content coverage", () => {
    const result = makeResult();
    result.raw.contentCoverage = "FAILED";
    result.raw.contentFailure = {
      code: "RAW_DIFF_LIMIT_EXCEEDED",
      retryable: false,
      retryAfterMs: 0,
      stage: "content",
      limitKind: "max_content_entries",
    };
    const unavailable = result.raw.files[1];
    if (!unavailable) throw new Error("Expected second fixture file.");
    unavailable.contentStatus = "UNAVAILABLE";
    unavailable.additions = undefined;
    unavailable.deletions = undefined;
    unavailable.patch = undefined;
    const payload = buildCodeDiffSuccessPayload(result, options());

    expect(payload.contentFailure).toEqual({
      code: "RAW_DIFF_LIMIT_EXCEEDED",
      retryable: false,
      retryAfterMs: 0,
      stage: "content",
      limitKind: "max_content_entries",
    });
    expect(payload.contentCoverage).toBe("failed");
    expect(payload.files[1]).toMatchObject({
      path: "second.ts",
      contentStatus: "unavailable",
    });
  });

  it("supports empty identical inventory results and unknown scope", () => {
    const result = makeResult();
    result.raw = {
      ...result.raw,
      summary: {
        filesChanged: 0,
        added: 0,
        deleted: 0,
        modified: 0,
        modeChanged: 0,
        typeChanged: 0,
        inventoryComplete: true,
        unprojectableFiles: 0,
      },
      scope: { status: "UNKNOWN" },
      contentCoverage: "NOT_REQUESTED",
      files: [],
      hasMoreFiles: false,
    };
    result.toResolution = {
      ...result.fromResolution,
      requested: "same",
    };
    result.fromResolution = { ...result.toResolution };

    const payload = buildCodeDiffSuccessPayload(
      result,
      options(repositoryTarget, "name-only"),
    );

    expect(payload.from.commitSha).toBe(payload.to.commitSha);
    expect(payload.from.requested).toBe("same");
    expect(payload.to.requested).toBe("same");
    expect(payload.scope).toEqual({ status: "unknown" });
    expect(payload.contentCoverage).toBe("not_requested");
    expect(payload.files).toEqual([]);
  });
});
