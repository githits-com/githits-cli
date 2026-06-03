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
