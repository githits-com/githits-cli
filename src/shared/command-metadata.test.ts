import { describe, expect, it } from "bun:test";
import {
  AUTHENTICATED_COMMANDS,
  getAuthenticatedCommandMetadata,
} from "./command-metadata.js";

describe("authenticated command metadata", () => {
  it("covers all authenticated JSON-capable commands", () => {
    expect(AUTHENTICATED_COMMANDS.map((entry) => entry.path)).toEqual([
      "example",
      "languages",
      "resolve",
      "feedback",
      "settings",
      "settings show",
      "settings get",
      "settings set",
      "settings clear",
      "settings terms",
      "settings terms accept",
      "search",
      "search-status",
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
