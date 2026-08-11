import { describe, expect, it } from "bun:test";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

describe("formatMappedErrorForTerminal", () => {
  it("formats AUTH_REQUIRED with CLI terminal remediation", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "AUTH_REQUIRED",
        message: "Authentication required.",
        retryable: false,
      }),
    ).toBe("Authentication required. Run `githits login` to authenticate.");
  });

  it("keeps distinct AUTH_REQUIRED messages in terminal output", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "AUTH_REQUIRED",
        message: "GitHits could not accept the authentication token.",
        retryable: false,
        details: { authSource: "server" },
      }),
    ).toBe(
      "GitHits could not accept the authentication token. Re-authenticate with `githits login` or update GITHITS_API_TOKEN if set. If this persists, contact support@githits.com.",
    );
  });

  it("mentions API token recovery for local auth failures", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "AUTH_REQUIRED",
        message: "No local GitHits authentication token found.",
        retryable: false,
        details: { authSource: "local" },
      }),
    ).toBe(
      "No local GitHits authentication token found. Run `githits login` to authenticate or set GITHITS_API_TOKEN.",
    );
  });

  it("leaves CLI JSON auth envelopes neutral", () => {
    expect(
      buildCliMappedErrorPayload({
        code: "AUTH_REQUIRED",
        message: "Authentication required.",
        retryable: false,
      }),
    ).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
    });
  });

  it("formats rate limits with provider-neutral retry timing", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "RATE_LIMITED",
        message: "Request limit reached.",
        retryable: true,
        details: { status: 429, retryAfterSeconds: 17 },
      }),
    ).toBe("Request limit reached. Try again in 17 seconds.");
  });

  it("formats rate limits without retry timing", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "RATE_LIMITED",
        message: "Request limit reached.",
        retryable: true,
      }),
    ).toBe("Request limit reached. Try again shortly.");
  });

  it("does not add retry guidance to non-retryable errors", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "RATE_LIMITED",
        message: "Request rejected.",
        retryable: false,
        details: { status: 429, retryAfterSeconds: 17 },
      }),
    ).toBe("Request rejected.");
  });

  it("does not duplicate API retry guidance", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "RATE_LIMITED",
        message: "Please retry later.",
        retryable: true,
        details: { status: 429, retryAfterSeconds: 17 },
      }),
    ).toBe("Please retry later.");
  });

  it("formats timeouts with provider-neutral retry guidance", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "TIMEOUT",
        message: "The request timed out.",
        retryable: true,
      }),
    ).toBe("The request timed out. Try again.");
  });

  it("preserves rate-limit metadata in CLI JSON envelopes", () => {
    expect(
      buildCliMappedErrorPayload({
        code: "RATE_LIMITED",
        message: "Request limit reached.",
        retryable: true,
        details: { status: 429, retryAfterSeconds: 17 },
      }),
    ).toEqual({
      error: "Request limit reached.",
      code: "RATE_LIMITED",
      retryable: true,
      details: { status: 429, retryAfterSeconds: 17 },
    });
  });

  it("leaves non-auth non-update terminal errors unchanged", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "BACKEND_ERROR",
        message: "No matching version found",
        retryable: false,
        details: { graphqlCode: "UNKNOWN_ERROR" },
      }),
    ).toBe("No matching version found");
  });

  it("preserves backend hints in terminal errors", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "NOT_FOUND",
        message: "Backend target message.",
        retryable: false,
        details: { hint: "Use the canonical package name." },
      }),
    ).toBe("Backend target message.\n  hint: Use the canonical package name.");
  });

  it("formats UPDATE_REQUIRED with update command", () => {
    expect(
      formatMappedErrorForTerminal({
        code: "UPDATE_REQUIRED",
        message: "Update required: Backend protocol changed",
        retryable: false,
        details: { updateCommand: "npm i -g githits@latest" },
      }),
    ).toBe(
      "Update required: Backend protocol changed\n\nUpdate with:\n  npm i -g githits@latest",
    );
  });
});
