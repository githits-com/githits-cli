import { describe, expect, it } from "bun:test";
import {
  GrepBackendError,
  GrepGraphQLError,
  GrepNetworkError,
  MalformedGrepResponseError,
} from "@githits/core-internal";
import { mapGrepError } from "./grep-error-map.js";

describe("unified grep errors", () => {
  it("describes a no-scopes issue without fabricated input attribution", () => {
    const mapped = mapGrepError(
      new GrepGraphQLError("No searchable scopes.", {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: false,
        target_issues: [{ reason: "no_grep_scopes", retryable: false }],
      }),
    );
    expect(mapped.message).toBe("No searchable scopes.");
    expect(mapped.code).toBe("UNRESOLVABLE");
    expect(mapped.details?.hint).toBeUndefined();
    expect(mapped.details?.targetIssues).toEqual([
      { reason: "no_grep_scopes", retryable: false },
    ]);
  });
  it("retains bounded public per-input preparation details and explicit retryability", () => {
    const issue = {
      input_index: 1,
      target: "npm:x",
      reason: "package_source_unavailable",
      retryable: true,
      suggested_refs: ["v1"],
      private_debug: "drop",
    };
    const error = mapGrepError(
      new GrepGraphQLError("not ready", {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: false,
        target_issues: Array(25).fill(issue),
      }),
    );
    expect(error.code).toBe("UNRESOLVABLE");
    expect(error.retryable).toBe(false);
    expect(error.details?.targetIssues).toHaveLength(20);
    expect(error.details?.targetIssues?.[0]).not.toHaveProperty(
      "private_debug",
    );
    expect(error.details?.hint).not.toContain("package_source_unavailable");
  });
  it.each([
    ["repository_indexing", "INDEXING"],
    ["documentation_publishing", "INDEXING"],
    ["documentation_discovery", "INDEXING"],
    ["site_v6_required", "INDEXING"],
    ["starting_url_pending", "INDEXING"],
    ["repository_not_found", "NOT_FOUND"],
    ["package_not_found", "NOT_FOUND"],
    ["package_source_not_found", "NOT_FOUND"],
    ["repository_ref_not_found", "REF_NOT_FOUND"],
    ["ref_not_found", "REF_NOT_FOUND"],
    ["package_source_ref_not_found", "VERSION_NOT_FOUND"],
    ["package_version_not_found", "VERSION_NOT_FOUND"],
    ["package_version_unresolved", "VERSION_NOT_FOUND"],
    ["repository_ref_ambiguous", "INVALID_ARGUMENT"],
    ["repository_resolution_error", "BACKEND_ERROR"],
    ["repository_unavailable", "BACKEND_ERROR"],
    ["site_ambiguous", "INVALID_ARGUMENT"],
    ...[
      "no_grep_scopes",
      "no_site_pages",
      "repository_legally_blocked",

      "package_source_unsupported",
      "package_security_removed",
      "package_scope_unavailable",
      "package_release_unusable",
      "site_not_indexed",
      "site_no_docs",
      "site_redirected",
      "site_failed",
      "documentation_site_not_admitted",
      "documentation_source_resolution_required",
      "documentation_site_no_docs",
      "documentation_site_identity_blocked",
      "documentation_site_failed",
      "documentation_unavailable",
      "starting_url_missed_at_cap",
      "starting_url_absent_from_current_corpus",
    ].map((reason) => [reason, "UNRESOLVABLE"]),
  ])("classifies %s as %s without changing backend facts", (reason, code) => {
    const issue = {
      reason,
      retryable: true,
      progress_ref: "progress",
      target: "npm:x",
    };
    const mapped = mapGrepError(
      new GrepGraphQLError("Backend diagnostic.", {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: true,
        target_issues: [issue],
      }),
    );
    expect(mapped).toMatchObject({
      code,
      retryable: true,
      message: "Backend diagnostic.",
      details: {
        graphqlCode: "GREP_TARGET_PREPARATION_REQUIRED",
        targetIssues: [issue],
      },
    });
    if (code === "INDEXING") {
      expect(mapped.details?.hint).toContain("npm:x: ");
      expect(mapped.details?.hint).not.toContain(reason);
    } else expect(mapped.details?.hint).toBeUndefined();
    const additional = mapGrepError(
      new GrepGraphQLError("First blocker.", {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: true,
        target_issues: [
          { reason: "repository_indexing", retryable: true },
          issue,
        ],
      }),
    );
    expect(additional.details?.hint).toContain("npm:x: ");
    expect(additional.details?.hint).not.toContain(reason);
    expect(additional.details?.hint).not.toContain("target is unavailable");
  });

  it.each([
    [
      { reason: "future_reason", retryable: true, progress_ref: "job" },
      "INDEXING",
    ],
    [
      { reason: "future_reason", retryable: false, progress_ref: "job" },
      "UNRESOLVABLE",
    ],
    [{ reason: "future_reason", retryable: true }, "UNRESOLVABLE"],
    [
      { reason: "future_reason", retryable: true, progress_ref: "  " },
      "UNRESOLVABLE",
    ],
    [{ reason: "future_reason", progress_ref: "job" }, "UNRESOLVABLE"],
    [
      { reason: "repository_indexing", retryable: false, progress_ref: "job" },
      "UNRESOLVABLE",
    ],
    [{ reason: "documentation_publishing", retryable: false }, "UNRESOLVABLE"],
    [{ reason: "documentation_discovery", retryable: false }, "UNRESOLVABLE"],
    [{ reason: "site_v6_required", retryable: false }, "UNRESOLVABLE"],
    [{ reason: "starting_url_pending", retryable: false }, "UNRESOLVABLE"],
  ] as const)("uses progress and retryability for %j", (issue, code) => {
    const mapped = mapGrepError(
      new GrepGraphQLError("Diagnostic", {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: true,
        target_issues: [issue],
      }),
    );
    expect(mapped.code).toBe(code);
    expect(mapped.retryable).toBe(true);
    expect(mapped.details?.targetIssues).toEqual([issue]);
  });

  it("uses the first terminal issue in backend order, including beyond the local detail bound", () => {
    const progress = { reason: "repository_indexing", retryable: true };
    const missing = { reason: "repository_not_found", retryable: false };
    const ambiguous = { reason: "repository_ref_ambiguous", retryable: false };
    for (const [issues, code] of [
      [[progress, missing, ambiguous], "NOT_FOUND"],
      [[progress, ambiguous, missing], "INVALID_ARGUMENT"],
      [[...Array(20).fill(progress), missing], "NOT_FOUND"],
      [
        [progress, { reason: "documentation_publishing", retryable: true }],
        "INDEXING",
      ],
    ] as const) {
      const mapped = mapGrepError(
        new GrepGraphQLError("Diagnostic", {
          code: "GREP_TARGET_PREPARATION_REQUIRED",
          target_issues: issues,
        }),
      );
      expect(mapped.code).toBe(code);
      expect(mapped.details?.targetIssues?.length).toBeLessThanOrEqual(20);
    }
  });

  it("does not call a backend-truncated list indexing when aggregate retryability is false", () => {
    const mapped = mapGrepError(
      new GrepGraphQLError("21 targets failed", {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: false,
        target_issues: Array(20).fill({
          reason: "repository_indexing",
          retryable: true,
        }),
      }),
    );
    expect(mapped).toMatchObject({ code: "UNRESOLVABLE", retryable: false });
  });

  it.each([
    { issues: undefined },
    { issues: [] },
    { issues: [null] },
    { issues: ["bad"] },
    { issues: [null, { reason: "repository_indexing", retryable: true }] },
  ])(
    "does not infer progress from absent or malformed issues %j",
    ({ issues }) => {
      expect(
        mapGrepError(
          new GrepGraphQLError("Diagnostic", {
            code: "GREP_TARGET_PREPARATION_REQUIRED",
            target_issues: issues,
          }),
        ).code,
      ).toBe("UNRESOLVABLE");
    },
  );

  it("keeps only additional diagnostics and path facts in readable hints", () => {
    const mapped = mapGrepError(
      new GrepGraphQLError("Repository not found.", {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: false,
        target_issues: [
          {
            target: "npm:a",
            reason: "repository_not_found",
            message: "Repository not found.",
            file_path: "src/a.ts",
          },
          { target: "npm:b", reason: "repository_ref_ambiguous" },
          {
            target: "npm:c",
            reason: "future_reason",
            message: "Choose a supported target.",
          },
          { target: "npm:d", reason: "future_reason" },
        ],
      }),
    );
    expect(mapped.details?.hint).toBe(
      "npm:a: path src/a.ts\nnpm:b: repository ref is ambiguous\nnpm:c: Choose a supported target.\nnpm:d: target is unavailable",
    );
    expect(mapped.details?.hint).not.toContain("repository_not_found");
    expect(mapped.details?.hint).not.toContain("future_reason");
  });

  it("drops raw package-source reason boilerplate without changing issue facts", () => {
    const issue = {
      target: "npm:b",
      reason: "repository_not_found",
      message:
        "Unable to resolve the source ref for npm:b; source was not searched. Reason: repository_not_found.",
    };
    const mapped = mapGrepError(
      new GrepGraphQLError("First blocker.", {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: false,
        target_issues: [{ reason: "no_grep_scopes" }, issue],
      }),
    );
    expect(mapped.details?.hint).toBe("npm:b: repository was not found");
    expect(mapped.details?.targetIssues?.[1]).toEqual(issue);
  });

  it("retains unknown progress identity and path when indexing replaces the backend headline", () => {
    const issue = {
      target: "npm:future",
      reason: "future_reason",
      retryable: true,
      progress_ref: "job",
      file_path: "lib/x.ts",
      message: "New preparation is queued.",
    };
    const mapped = mapGrepError(
      new GrepGraphQLError(issue.message, {
        code: "GREP_TARGET_PREPARATION_REQUIRED",
        retryable: true,
        target_issues: [issue],
      }),
    );
    expect(mapped).toMatchObject({
      code: "INDEXING",
      retryable: true,
      message: issue.message,
      details: {
        targetIssues: [issue],
        hint: "npm:future: target is being prepared; path lib/x.ts",
      },
    });
  });

  it("keeps cursor invalid, protocol, transport, deadline and HTTP failures distinct", () => {
    expect(
      mapGrepError(
        new GrepGraphQLError("invalid", {
          code: "GREP_CURSOR_INVALID",
          retryable: false,
        }),
      ),
    ).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      details: {
        graphqlCode: "GREP_CURSOR_INVALID",
        hint: "Restart explicitly without the cursor, using the same targets and controls.",
      },
    });
    expect(
      mapGrepError(
        new GrepGraphQLError("bad response", {
          code: "GREP_BACKEND_PROTOCOL_ERROR",
          retryable: true,
        }),
      ),
    ).toMatchObject({ code: "PROTOCOL_ERROR", retryable: true });
    expect(mapGrepError(new MalformedGrepResponseError()).code).toBe(
      "PROTOCOL_ERROR",
    );
    expect(mapGrepError(new GrepNetworkError("socket")).code).toBe("NETWORK");
    expect(
      mapGrepError(new GrepBackendError("deadline", undefined, "TIMEOUT", true))
        .code,
    ).toBe("TIMEOUT");
    expect(mapGrepError(new GrepBackendError("rate", 429))).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      details: { status: 429 },
    });
    expect(mapGrepError(new GrepBackendError("server", 503)).retryable).toBe(
      true,
    );
  });
});

it("classifies the native mask-bound cursor rejection without discarding its code", () => {
  expect(
    mapGrepError(
      new GrepGraphQLError(
        "The MULTI_GREP cursor is invalid for this request.",
        { code: "MULTI_GREP_CURSOR_INVALID", retryable: false },
      ),
    ),
  ).toMatchObject({
    code: "INVALID_ARGUMENT",
    retryable: false,
    details: {
      graphqlCode: "MULTI_GREP_CURSOR_INVALID",
      hint: expect.stringContaining("Restart explicitly without the cursor"),
    },
  });
});
