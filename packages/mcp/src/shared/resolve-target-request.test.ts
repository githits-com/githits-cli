import { describe, expect, it } from "bun:test";
import { PKGSEER_REGISTRY_ARGS } from "@githits/core-internal";
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

  it("accepts every resolver target kind", () => {
    for (const [preferKind, expected] of [
      ["package", "PACKAGE"],
      ["repository", "REPOSITORY"],
      ["site", "SITE"],
    ] as const) {
      expect(
        buildResolveTargetParams({
          name: "documentation",
          preferKind,
          includeDetailedFields: false,
        }).preferredKinds,
      ).toEqual([expected]);
    }
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
        preferKind: "workspace",
        includeDetailedFields: false,
      }),
    ).toThrow("Preferred kind expects package, repository, or site");
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

  it("normalizes MCP registry arrays and preferred kind", () => {
    expect(
      buildResolveTargetParams({
        name: "express",
        registries: [" npm ", "NPM", "", "pypi", "PyPI"],
        preferKind: " repository ",
        includeDetailedFields: false,
      }),
    ).toMatchObject({
      registries: ["NPM", "PYPI"],
      preferredKinds: ["REPOSITORY"],
    });
  });

  it.each([
    ...PKGSEER_REGISTRY_ARGS.map((registry) => `${registry}:example`),
    "npm:@types/node",
    "npm:react@18.2.0",
    "npm: react state management",
    "github:facebook/react",
    "github:facebook/react#main",
    "github.com/facebook/react",
    "github.com/facebook/react@main",
    "https://github.com/facebook/react",
    "http://github.com/facebook/react#main",
    "site:expressjs.com",
    "site:https://expressjs.com/en/guide/",
  ])("rejects already-canonical target %s", (name) => {
    expect(() =>
      buildResolveTargetParams({ name, includeDetailedFields: false }),
    ).toThrow(
      `Canonical target ${JSON.stringify(name)} does not need resolution. Pass it directly to the next GitHits tool.`,
    );
  });

  it.each([
    "@scope/package",
    "react-native",
    "owner/repository",
    "GitHub Copilot",
    "npm package react",
    "acme:widget",
  ])("preserves nearby human name %s", (name) => {
    expect(
      buildResolveTargetParams({ name, includeDetailedFields: false }),
    ).toMatchObject({ name });
  });

  it("rejects invalid MCP registry entries and preserves an empty filter", () => {
    expect(() =>
      buildResolveTargetParams({
        name: "express",
        registries: ["npm", "cargo"],
        includeDetailedFields: false,
      }),
    ).toThrow("Unsupported registry 'cargo'");
    expect(
      buildResolveTargetParams({
        name: "express",
        registries: [],
        includeDetailedFields: false,
      }),
    ).not.toHaveProperty("registries");
  });
});
