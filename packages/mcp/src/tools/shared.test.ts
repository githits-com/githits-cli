import { describe, expect, it } from "bun:test";
import { TermsAcceptanceRequiredError } from "@githits/core-internal";
import {
  addLocalMcpAuthAction,
  buildMcpErrorPayload,
  withErrorHandling,
} from "./shared.js";

describe("MCP tool execution context", () => {
  it("uses the acceptance URL for the default terms remediation", () => {
    const error = new TermsAcceptanceRequiredError({
      acceptanceUrl: "https://acceptance.example.test/settings/privacy",
    });

    expect(
      buildMcpErrorPayload({
        code: "TERMS_ACCEPTANCE_REQUIRED",
        message: error.message,
        retryable: false,
        details: {
          termsUrl: error.termsUrl,
          acceptanceUrl: error.acceptanceUrl,
        },
      }),
    ).toEqual({
      error:
        "Terms acceptance required. Review and accept the current terms at https://acceptance.example.test/settings/privacy, then retry.",
      code: "TERMS_ACCEPTANCE_REQUIRED",
      retryable: false,
      details: {
        termsUrl: "https://githits.com/legal/terms-of-service/",
        acceptanceUrl: "https://acceptance.example.test/settings/privacy",
        action: "https://acceptance.example.test/settings/privacy",
      },
    });
  });

  it("uses one explicit terms remediation override for message and action", () => {
    const payload = addLocalMcpAuthAction(
      {
        error: "Terms acceptance required.",
        code: "TERMS_ACCEPTANCE_REQUIRED",
        retryable: false,
        details: {
          termsUrl: "https://githits.com/legal/terms-of-service/",
          acceptanceUrl: "https://app.githits.com/settings/privacy",
        },
      },
      {
        termsRemediation: {
          message: "Accept the terms, then retry.",
          action: "githits settings terms accept",
        },
      },
    );

    expect(payload as unknown).toEqual({
      error: "Accept the terms, then retry.",
      code: "TERMS_ACCEPTANCE_REQUIRED",
      retryable: false,
      details: {
        termsUrl: "https://githits.com/legal/terms-of-service/",
        acceptanceUrl: "https://app.githits.com/settings/privacy",
        action: "githits settings terms accept",
      },
    });
  });

  it("rethrows a caller cancellation instead of returning a tool error", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);

    await expect(
      withErrorHandling(
        "search",
        async () => {
          throw reason;
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);
  });

  it("rethrows an AbortError while the supplied signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const abortError = new DOMException("aborted", "AbortError");
    await expect(
      withErrorHandling(
        "search",
        async () => {
          throw abortError;
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(abortError);
  });
});
