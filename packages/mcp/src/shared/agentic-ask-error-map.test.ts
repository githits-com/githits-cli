import { expect, it } from "bun:test";
import { AgenticAskHttpError } from "@githits/core-internal";
import { mapAgenticAskError } from "./agentic-ask-error-map.js";

it("retains actionable Ask diagnostics in the shared CLI/MCP error envelope", () => {
  const targetError = {
    code: "TARGET_RESOLUTION_FAILED" as const,
    message: "The target lookup found no supported match.",
    hint: "Check the exact repository or registry/package identity.",
    reason: "missing_best" as const,
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
      details: { status: 400, reason: "missing_best", hint: targetError.hint },
    },
    toolCallId: "call-id",
    threadId: "thread-id",
  });
});
