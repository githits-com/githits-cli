import { describe, expect, it } from "bun:test";
import {
  GrepBackendError,
  GrepGraphQLError,
  GrepNetworkError,
  MalformedGrepResponseError,
} from "@githits/core-internal";
import { mapGrepError } from "./grep-error-map.js";

describe("unified grep errors", () => {
  it("retains bounded public per-input preparation details and explicit retryability", () => {
    const issue = {
      input_index: 1,
      target: "npm:x",
      reason: "repository_indexing",
      retryable: true,
      progress_ref: "index:1",
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
    expect(error.code).toBe("INDEXING");
    expect(error.retryable).toBe(false);
    expect(error.details?.targetIssues).toHaveLength(20);
    expect(error.details?.targetIssues?.[0]).not.toHaveProperty(
      "private_debug",
    );
    expect(error.details?.hint).toContain(
      "Input 1: repository_indexing; progress index:1",
    );
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
