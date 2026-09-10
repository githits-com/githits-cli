import { expect, it } from "bun:test";
import { AgenticAskHttpError } from "@githits/core-internal";
import { mapAgenticAskError } from "./agentic-ask-error-map.js";

it.each([
  { code: "TARGET_RESOLUTION_FAILED", reason: "missing_best" },
  { code: "TARGET_VERSION_UNAVAILABLE", reason: "version_not_indexed" },
])(
  "retains Ask diagnostics in the shared CLI/MCP envelope: %j",
  ({ code, reason }) => {
    const targetError = {
      code,
      message: "The target lookup found no supported match.",
      hint: "Check the exact repository or registry/package identity.",
      reason,
    };
    const message = `${targetError.message} ${targetError.hint}`;
    const result = mapAgenticAskError(
      new AgenticAskHttpError(
        "INVALID_TARGET",
        message,
        400,
        "call-id",
        undefined,
        false,
        "thread-id",
        targetError,
      ),
    );
    expect(result).toEqual({
      mapped: {
        code: "INVALID_ARGUMENT",
        message,
        retryable: false,
        details: {
          status: 400,
          targetErrorCode: code,
          reason,
          hint: targetError.hint,
        },
      },
      toolCallId: "call-id",
      threadId: "thread-id",
    });
  },
);

it.each([
  "INVALID_TARGET_SYNTAX",
  "TARGET_RESOLUTION_FAILED",
  "TARGET_VERSION_UNAVAILABLE",
])("keeps %s separate from an absent resolver reason", (code) => {
  const targetError = {
    code,
    message: "Target error.",
    hint: "Check the target.",
  };
  const result = mapAgenticAskError(
    new AgenticAskHttpError(
      "INVALID_TARGET",
      "Target error. Check the target.",
      400,
      undefined,
      undefined,
      false,
      undefined,
      targetError,
    ),
  );
  expect(result.mapped.details).toEqual({
    status: 400,
    targetErrorCode: code,
    hint: targetError.hint,
  });
});
