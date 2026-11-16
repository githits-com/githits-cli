import { describe, expect, it } from "bun:test";
import {
  buildContainingPathPrefix,
  buildPathPrefixSuggestion,
} from "./file-path-recovery.js";

describe("literal recovery paths", () => {
  it("keeps whitespace in the containing directory", () => {
    expect(buildContainingPathPrefix(" src /file.ts ")).toBe(" src /");
    expect(buildPathPrefixSuggestion(" src /file.ts ")).toBe(" src /");
  });

  it("preserves literal directory candidates without stripping whitespace", () => {
    expect(buildPathPrefixSuggestion(" src / ")).toBe(" src / /");
    expect(buildPathPrefixSuggestion(" src /")).toBe(" src /");
  });

  it("keeps blank requests at the inventory root", () => {
    expect(buildContainingPathPrefix("   ")).toBe("");
    expect(buildPathPrefixSuggestion("   ")).toBe("");
  });
});
