import { describe, expect, it } from "bun:test";
import { withCliAuthAttribution } from "./oauth-attribution.js";

describe("withCliAuthAttribution", () => {
  it("adds stable attribution to the callback URI", () => {
    expect(withCliAuthAttribution("http://127.0.0.1:8080/callback")).toBe(
      "http://127.0.0.1:8080/callback?utm_source=githits-cli&utm_medium=cli&utm_campaign=cli-auth",
    );
  });

  it("preserves unrelated query parameters", () => {
    expect(
      withCliAuthAttribution("http://127.0.0.1:8080/callback?existing=value"),
    ).toBe(
      "http://127.0.0.1:8080/callback?existing=value&utm_source=githits-cli&utm_medium=cli&utm_campaign=cli-auth",
    );
  });

  it("replaces attribution values without duplicating them", () => {
    const uri =
      "http://127.0.0.1:8080/callback?utm_source=old&utm_campaign=old";

    expect(withCliAuthAttribution(withCliAuthAttribution(uri))).toBe(
      "http://127.0.0.1:8080/callback?utm_source=githits-cli&utm_campaign=cli-auth&utm_medium=cli",
    );
  });
});
