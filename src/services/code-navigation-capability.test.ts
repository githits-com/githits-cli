import { describe, expect, it } from "bun:test";
import { getCodeNavigationCapability } from "./code-navigation-capability.js";
import { createJwtToken } from "./test-helpers.js";

describe("getCodeNavigationCapability", () => {
  it("returns enabled for top-level feature_flags claim", () => {
    const token = createJwtToken({ feature_flags: ["code_navigation"] });
    expect(getCodeNavigationCapability(token)).toBe("enabled");
  });

  it("returns enabled for nested claims.feature_flags", () => {
    const token = createJwtToken({
      claims: { feature_flags: ["code_navigation"] },
    });
    expect(getCodeNavigationCapability(token)).toBe("enabled");
  });

  it("returns disabled when feature flag array exists without the flag", () => {
    const token = createJwtToken({ feature_flags: ["other_feature"] });
    expect(getCodeNavigationCapability(token)).toBe("disabled");
  });

  it("returns unknown for opaque tokens", () => {
    expect(getCodeNavigationCapability("ghi-opaque-token")).toBe("unknown");
  });

  it("returns unknown for malformed jwt payload", () => {
    expect(getCodeNavigationCapability("a.broken.c")).toBe("unknown");
  });
});
