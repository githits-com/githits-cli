import { describe, expect, it } from "bun:test";
import {
  createTermsAcceptanceError,
  TermsAcceptanceRequiredError,
  throwIfTermsAcceptanceRequired,
} from "./terms-acceptance.js";

describe("terms acceptance contract", () => {
  it("parses a REST response with an environment-specific acceptance URL", () => {
    expect(
      createTermsAcceptanceError({
        code: "TERMS_ACCEPTANCE_REQUIRED",
        terms_url: "https://githits.com/legal/terms-of-service/",
        acceptance_url: "https://acceptance.example.test/settings/privacy",
      }),
    ).toMatchObject({
      termsUrl: "https://githits.com/legal/terms-of-service/",
      acceptanceUrl: "https://acceptance.example.test/settings/privacy",
    });
  });

  it("parses the same contract from GraphQL extensions", () => {
    expect(() =>
      throwIfTermsAcceptanceRequired({
        errors: [
          {
            extensions: { code: "TERMS_ACCEPTANCE_REQUIRED" },
          },
        ],
      }),
    ).toThrow(TermsAcceptanceRequiredError);
  });

  it("ignores unrelated access errors", () => {
    expect(() =>
      throwIfTermsAcceptanceRequired({ code: "FORBIDDEN" }),
    ).not.toThrow();
  });
});
