import { describe, expect, it } from "bun:test";
import {
  buildResolveTargetParams,
  RESOLVE_TARGET_DEFAULT_LIMIT,
} from "./resolve-target-request.js";

describe("buildResolveTargetParams", () => {
  it("trims the name and applies the shared default", () => {
    expect(
      buildResolveTargetParams({
        name: "  express  ",
        includeDetailedFields: false,
      }),
    ).toEqual({
      name: "express",
      limit: RESOLVE_TARGET_DEFAULT_LIMIT,
      includeDetailedFields: false,
    });
  });

  it("normalizes all ranking hints to GraphQL params", () => {
    expect(
      buildResolveTargetParams({
        name: "express",
        query: "  web framework  ",
        registry: " npm, PYPI, npm, ,",
        preferKind: " Repository ",
        intentHints: [" Server ", "server", "", "CLI"],
        limit: 3,
        includeDetailedFields: true,
      }),
    ).toEqual({
      name: "express",
      query: "web framework",
      registries: ["NPM", "PYPI"],
      preferredKinds: ["REPOSITORY"],
      intentHints: ["Server", "CLI"],
      limit: 3,
      includeDetailedFields: true,
    });
  });

  it("drops empty optional values", () => {
    expect(
      buildResolveTargetParams({
        name: "express",
        query: " ",
        registry: " , ",
        preferKind: " ",
        intentHints: ["", " "],
        includeDetailedFields: false,
      }),
    ).toEqual({
      name: "express",
      limit: 8,
      includeDetailedFields: false,
    });
  });

  it("rejects empty names and unsupported enums", () => {
    expect(() =>
      buildResolveTargetParams({ name: " ", includeDetailedFields: false }),
    ).toThrow("Target name is required");
    expect(() =>
      buildResolveTargetParams({
        name: "x",
        registry: "cargo",
        includeDetailedFields: false,
      }),
    ).toThrow("Unsupported registry 'cargo'");
    expect(() =>
      buildResolveTargetParams({
        name: "x",
        registry: "constructor",
        includeDetailedFields: false,
      }),
    ).toThrow("Unsupported registry 'constructor'");
    expect(() =>
      buildResolveTargetParams({
        name: "x",
        preferKind: "site",
        includeDetailedFields: false,
      }),
    ).toThrow("prefer-kind expects package or repository");
  });

  it("rejects non-integer and out-of-range limits", () => {
    for (const limit of [0, 21, 1.5, Number.NaN]) {
      expect(() =>
        buildResolveTargetParams({
          name: "x",
          limit,
          includeDetailedFields: false,
        }),
      ).toThrow("limit expects an integer between 1 and 20");
    }
  });
});
