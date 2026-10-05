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
    const mapped = withIndexingRetryAction(pending, "read", "mcp", 60000);
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
  it("uses singular metadata, no-history defaults and native seconds without fabricated entries", () => {
    const singular: MappedError = {
      code: "INDEXING",
      message: "Indexing",
      details: { indexingEstimate: { lowerSeconds: 33, upperSeconds: 85 } },
    };
    expect(
      withIndexingRetryAction(singular, "list", "cli").details?.action,
    ).toBe("Retry this list with --wait 100000.");
    expect(
      withIndexingRetryAction(
        singular,
        "search",
        "cli",
        120000,
        false,
        "seconds",
      ).details?.action,
    ).toBe("Retry this search with --wait 100.");
    const empty = withIndexingRetryAction(
      { code: "INDEXING", message: "Indexing" },
      "list",
      "mcp",
      120000,
      true,
    );
    expect(empty.details?.action).toBe(
      "Retry this list with wait_timeout_ms=30000. Leave out after.",
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
    expect(output).toContain("Indexed versions/refs: 1.0.2");
    expect(output).toContain("Use a specific available ref.");
    expect(output).not.toContain("\u001b");
    expect(output.split("\n").some((line) => line.startsWith("    "))).toBe(
      true,
    );
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
