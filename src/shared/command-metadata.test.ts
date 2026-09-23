import { describe, expect, it } from "bun:test";
import {
  AUTHENTICATED_COMMANDS,
  getAuthenticatedCommandMetadata,
} from "./command-metadata.js";

describe("authenticated command metadata", () => {
  it("covers all authenticated JSON-capable commands", () => {
    expect(AUTHENTICATED_COMMANDS.map((entry) => entry.path)).toEqual([
      "research",
      "example",
      "resolve",
      "settings",
      "settings show",
      "settings get",
      "settings set",
      "settings clear",
      "settings terms",
      "settings terms accept",
      "search",
      "search-status",
      "read",
      "code files",
      "code read",
      "code grep",
      "docs list",
      "docs read",
      "pkg info",
      "pkg vulns",
      "pkg deps",
      "pkg changelog",
      "pkg upgrade-review",
    ]);
  });

  it("marks unified read as auto-login eligible and JSON-capable", () => {
    expect(getAuthenticatedCommandMetadata("read")).toEqual({
      path: "read",
      autoLoginEligible: true,
      postLoginMessage: "Authentication complete. Running command...",
      jsonCapable: true,
    });
  });

  it("marks research as auto-login eligible and JSON-capable", () => {
    expect(getAuthenticatedCommandMetadata("research")).toEqual({
      path: "research",
      autoLoginEligible: true,
      postLoginMessage: "Authentication complete. Running research...",
      jsonCapable: true,
    });
    expect(getAuthenticatedCommandMetadata("ask")).toBeUndefined();
  });

  it("marks resolve as auto-login eligible and JSON-capable", () => {
    expect(getAuthenticatedCommandMetadata("resolve")).toEqual({
      path: "resolve",
      autoLoginEligible: true,
      postLoginMessage: "Authentication complete. Resolving target...",
      jsonCapable: true,
    });
  });

  it("marks pkg upgrade-review as auto-login eligible", () => {
    expect(getAuthenticatedCommandMetadata("pkg upgrade-review")).toMatchObject(
      {
        autoLoginEligible: true,
        jsonCapable: true,
        postLoginMessage: "Authentication complete. Running command...",
      },
    );
  });
});
