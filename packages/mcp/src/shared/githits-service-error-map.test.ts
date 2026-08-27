import { describe, expect, it } from "bun:test";
import {
  ApiRateLimitError,
  AuthenticationError,
  FetchTimeoutError,
  TermsAcceptanceRequiredError,
} from "@githits/core-internal";
import { mapGitHitsServiceError } from "./githits-service-error-map.js";

describe("mapGitHitsServiceError", () => {
  it("preserves stable terms acceptance remediation", () => {
    expect(
      mapGitHitsServiceError("search", new TermsAcceptanceRequiredError()),
    ).toEqual({
      code: "TERMS_ACCEPTANCE_REQUIRED",
      message: "Terms acceptance required.",
      retryable: false,
      details: {
        termsUrl: "https://githits.com/legal/terms-of-service/",
        acceptanceUrl: "https://app.githits.com/settings/privacy",
      },
    });
  });
  it("maps authentication errors without changing their message or source", () => {
    const mapped = mapGitHitsServiceError(
      "perform request",
      new AuthenticationError("Authentication required.", "server"),
    );

    expect(mapped).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required.",
      retryable: false,
      details: { authSource: "server" },
    });
  });

  it("maps API rate limits with retry metadata", () => {
    const mapped = mapGitHitsServiceError(
      "perform request",
      new ApiRateLimitError("Request rate limited.", 17),
    );

    expect(mapped).toEqual({
      code: "RATE_LIMITED",
      message: "Request rate limited.",
      retryable: true,
      details: {
        status: 429,
        retryAfterSeconds: 17,
      },
    });
  });

  it("omits unavailable retry timing from API rate limits", () => {
    const mapped = mapGitHitsServiceError(
      "perform request",
      new ApiRateLimitError(),
    );

    expect(mapped).toEqual({
      code: "RATE_LIMITED",
      message: "Request rate limited.",
      retryable: true,
      details: { status: 429 },
    });
  });

  it("maps fetch timeouts with the operation and configured timeout", () => {
    const mapped = mapGitHitsServiceError(
      "perform request",
      new FetchTimeoutError(2_500),
    );

    expect(mapped).toEqual({
      code: "TIMEOUT",
      message: "Failed to perform request: Request timed out after 2500ms.",
      retryable: true,
      details: { timeoutMs: 2_500 },
    });
  });

  it("preserves the existing unknown Error envelope", () => {
    const mapped = mapGitHitsServiceError(
      "perform request",
      new Error("Unexpected response"),
    );

    expect(mapped).toEqual({
      code: "UNKNOWN",
      message: "Failed to perform request: Unexpected response",
      retryable: false,
    });
  });

  it("preserves the existing non-Error fallback", () => {
    const mapped = mapGitHitsServiceError("perform request", undefined);

    expect(mapped).toEqual({
      code: "UNKNOWN",
      message: "Failed to perform request: Unknown error",
      retryable: false,
    });
  });
});
