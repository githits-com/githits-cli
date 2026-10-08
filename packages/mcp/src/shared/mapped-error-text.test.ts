import { describe, expect, it } from "bun:test";
import { mcpMappedErrorResult } from "../tools/shared.js";
import type { MappedError } from "./mapped-error.js";
import {
  formatMappedErrorText,
  withIndexingRetryAction,
} from "./mapped-error-text.js";

const pending: MappedError = {
  code: "INDEXING",
  message: "Internal indexing message",
  retryable: true,
  details: {
    indexingRef: "opaque-progress",
    indexingEstimates: [
      {
        kind: "REPOSITORY",
        targets: ["npm:express@1.0.3"],
        estimate: { lowerSeconds: 33, upperSeconds: 85, elapsedSeconds: 90 },
      },
    ],
  },
};
describe("readable mapped error content", () => {
  it("uses readable default and explicit text, keeping JSON opt-in and host actions", () => {
    const mapped: MappedError = {
      code: "AUTH_REQUIRED",
      message: "Authentication required.",
      retryable: false,
    };
    for (const format of [undefined, "text"] as const) {
      const result = mcpMappedErrorResult(
        mapped,
        { authAction: "Authenticate with this host." },
        format,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(
        "Authentication required.\n\nAuthenticate with this host.",
      );
    }
    const result = mcpMappedErrorResult(
      mapped,
      { authAction: "Authenticate with this host." },
      "json",
    );
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { action: "Authenticate with this host." },
    });
  });
  it("keeps pending evidence on one row, hides progress scaffolding and does not subtract elapsed", () => {
    const mapped = withIndexingRetryAction(pending, "read", "mcp", {
      maxWaitMs: 60000,
    });
    const output = formatMappedErrorText(mapped, {
      width: 160,
      indexingOutcome: "This content is not available yet.",
    });
    expect(output).toContain(
      "npm:express@1.0.3 (indexing, estimated total: 33-85s, time spent indexing: 90s)",
    );
    expect(output).toEndWith("Retry this read with wait_timeout_ms=60000.");
    expect(output).not.toContain("opaque-progress");
    expect(output).not.toContain("Internal indexing");
    expect(pending.details?.action).toBeUndefined();
    expect(
      JSON.parse(
        mcpMappedErrorResult(mapped, undefined, "json").content[0]!.text,
      ).details.indexingRef,
    ).toBe("opaque-progress");
  });
  it("uses singular metadata, no-history defaults and native milliseconds without fabricated entries", () => {
    const singular: MappedError = {
      code: "INDEXING",
      message: "Indexing",
      details: { indexingEstimate: { lowerSeconds: 33, upperSeconds: 85 } },
    };
    expect(
      withIndexingRetryAction(singular, "list", "cli").details?.action,
    ).toBe("Retry this list with --wait 100000.");
    expect(
      withIndexingRetryAction(singular, "search", "cli", {
        maxWaitMs: 120000,
      }).details?.action,
    ).toBe("Retry this search with --wait 100000.");
    const empty = withIndexingRetryAction(
      { code: "INDEXING", message: "Indexing" },
      "list",
      "mcp",
      { maxWaitMs: 120000, hasAfter: true },
    );
    expect(empty.details?.action).toBe(
      "Retry this list with wait_timeout_ms=30000. Leave out the after argument.",
    );
    expect(empty.details?.indexingEstimates).toBeUndefined();
    expect(formatMappedErrorText(empty)).toContain("no estimate available");
  });
  it("keeps backend hints/alternatives and sanitizes controls with hanging bullet wrapping", () => {
    const output = formatMappedErrorText(
      {
        ...pending,
        details: {
          ...pending.details,
          availableVersions: [{ version: "1.0.2", ref: "v1.0.2" }],
          hint: "Use a specific available ref.\u001b[31m",
        },
      },
      { width: 50 },
    );
    expect(output).toContain("Indexed alternatives: versions/refs 1.0.2");
    expect(output).toContain("Use a specific available ref.");
    expect(output).not.toContain("\u001b");
    expect(output.split("\n").some((line) => line.startsWith("    "))).toBe(
      true,
    );
  });
  it("lists overlapping repository refs once while retaining package versions and JSON evidence", () => {
    const mapped: MappedError = {
      code: "INDEXING",
      message: "Indexing",
      details: {
        availableVersions: [
          { ref: "rel_2_0_0" },
          { ref: "rel_2_0_1" },
          { version: "2.0.0", ref: "rel_2_0_0" },
        ],
        availableRefs: [{ ref: "rel_2_0_0" }],
      },
    };
    const text = formatMappedErrorText(mapped);
    expect(text).toContain(
      "Indexed alternatives: versions/refs rel_2_0_1, 2.0.0",
    );
    expect(text).toContain("refs rel_2_0_0");
    expect(text.match(/rel_2_0_0/g)).toHaveLength(1);
    const json = JSON.parse(
      mcpMappedErrorResult(mapped, undefined, "json").content[0]!.text,
    );
    expect(json.details.availableVersions).toEqual(
      mapped.details!.availableVersions,
    );
    expect(json.details.availableRefs).toEqual(mapped.details!.availableRefs);
    const refsOnly = formatMappedErrorText({
      ...mapped,
      details: {
        availableVersions: [{ ref: "rel_2_0_0" }],
        availableRefs: [{ ref: "rel_2_0_0" }],
      },
    });
    expect(refsOnly).not.toContain("versions/refs:");
    expect(refsOnly).toContain("refs rel_2_0_0");
  });
});

describe("readable non-indexing recovery", () => {
  it("does not claim CodeDiff resolver alternatives are indexed and retains ref identities", () => {
    const text = formatMappedErrorText({
      code: "VERSION_NOT_FOUND",
      message: "Version was not found.",
      details: {
        availableVersions: [{ version: "1.0.2", ref: "release-1" }],
        refKinds: ["BRANCH", "TAG"],
      },
    });
    expect(text).toContain("Available versions/refs: 1.0.2 (ref: release-1)");
    expect(text).not.toContain("Indexed");
    expect(text).toContain("Matching ref types: BRANCH, TAG");
  });
  it("renders supplied retry timing without exposing a millisecond field name", () => {
    const mapped: MappedError = {
      code: "RATE_LIMITED",
      message: "Request rate limited.",
      retryable: true,
      details: { retryAfterMs: 12001 },
    };
    expect(formatMappedErrorText(mapped)).toEndWith("Try again in 13 seconds.");
    expect(
      JSON.parse(
        mcpMappedErrorResult(mapped, undefined, "json").content[0]!.text,
      ).details.retryAfterMs,
    ).toBe(12001);
  });
});

describe("retryable text errors", () => {
  it.each(["NETWORK", "TIMEOUT", "BACKEND_ERROR"] as const)(
    "retains actionable retryability for %s",
    (code) => {
      const mapped: MappedError = {
        code,
        message: "Request failed.",
        retryable: true,
      };
      expect(formatMappedErrorText(mapped)).toEndWith("Try again.");
      expect(
        formatMappedErrorText({ ...mapped, retryable: false }),
      ).not.toContain("Try again.");
      expect(
        formatMappedErrorText({
          ...mapped,
          details: { action: "Use the host recovery action." },
        }),
      ).toEndWith("Use the host recovery action.");
    },
  );
  it("keeps unlabelled preparation a consistent bullet rather than a stray sentence", () => {
    const text = formatMappedErrorText(
      withIndexingRetryAction(
        { code: "INDEXING", message: "Indexing" },
        "read",
        "mcp",
      ),
    );
    expect(text).toContain(
      "Preparing:\n  - Source (indexing, no estimate available)",
    );
  });
});

describe("existing retry advice", () => {
  it.each([
    ["TIMEOUT", "Request to GitHits timed out. Try again."],
    ["BACKEND_ERROR", "Server error (503). Try again shortly."],
  ] as const)("does not repeat %s retry prose", (code, message) => {
    expect(formatMappedErrorText({ code, message, retryable: true })).toBe(
      message,
    );
  });
  it("retains a backend retry hint without adding generic advice", () => {
    const text = formatMappedErrorText({
      code: "NETWORK",
      message: "Request failed.",
      retryable: true,
      details: { hint: "Retry after reconnecting." },
    });
    expect(text).toBe("Request failed.\n\nRetry after reconnecting.");
  });
});
