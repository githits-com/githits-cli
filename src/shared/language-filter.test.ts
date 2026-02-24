import { describe, expect, it } from "bun:test";
import type { Language } from "../services/githits-service.js";
import { filterLanguages } from "./language-filter.js";

const testLanguages: Language[] = [
  { id: "1", name: "javascript", display_name: "JavaScript", aliases: ["js"] },
  { id: "2", name: "typescript", display_name: "TypeScript", aliases: ["ts"] },
  { id: "3", name: "python", display_name: "Python", aliases: ["py"] },
];

describe("filterLanguages", () => {
  it("filters by name match", () => {
    const result = filterLanguages(testLanguages, "java");

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("javascript");
  });

  it("filters by alias match", () => {
    const result = filterLanguages(testLanguages, "js");

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("javascript");
  });

  it("filters by display_name match", () => {
    const result = filterLanguages(testLanguages, "Type");

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("typescript");
  });

  it("is case-insensitive", () => {
    const result = filterLanguages(testLanguages, "PYTHON");

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("python");
  });

  it("returns empty array when no matches", () => {
    const result = filterLanguages(testLanguages, "zzzzz");

    expect(result).toHaveLength(0);
  });

  it("limits results to 5 by default", () => {
    const manyLanguages: Language[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `lang${i}`,
      display_name: `Language ${i}`,
      aliases: [],
    }));

    const result = filterLanguages(manyLanguages, "lang");

    expect(result).toHaveLength(5);
  });

  it("respects custom limit", () => {
    const manyLanguages: Language[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `lang${i}`,
      display_name: `Language ${i}`,
      aliases: [],
    }));

    const result = filterLanguages(manyLanguages, "lang", 3);

    expect(result).toHaveLength(3);
  });

  it("returns only name and display_name", () => {
    const result = filterLanguages(testLanguages, "python");

    expect(result).toHaveLength(1);
    const match = result[0];
    expect(match).toEqual({ name: "python", display_name: "Python" });
    expect(match && Object.keys(match)).toEqual(["name", "display_name"]);
  });
});
