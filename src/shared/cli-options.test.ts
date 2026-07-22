import { describe, expect, it } from "bun:test";
import { InvalidArgumentError } from "commander";
import { parsePortCliOption } from "./cli-options.js";

describe("parsePortCliOption", () => {
  for (const [raw, expected] of [
    ["1", 1],
    ["8765", 8765],
    ["65535", 65535],
    [" 8080 ", 8080],
  ] as const) {
    it(`parses ${JSON.stringify(raw)}`, () => {
      expect(parsePortCliOption(raw)).toBe(expected);
    });
  }

  for (const raw of [
    "",
    "0",
    "-1",
    "65536",
    "1.5",
    "8080junk",
    "1e3",
    "NaN",
    "Infinity",
  ]) {
    it(`rejects ${JSON.stringify(raw)}`, () => {
      expect(() => parsePortCliOption(raw)).toThrow(InvalidArgumentError);
      expect(() => parsePortCliOption(raw)).toThrow(
        "Port must be an integer between 1 and 65535.",
      );
    });
  }
});
