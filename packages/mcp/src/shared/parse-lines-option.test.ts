import { describe, expect, it } from "bun:test";
import {
  type LineRange,
  MAX_READ_LINE,
  parseLinesOption,
  parsePositiveReadLine,
} from "./parse-lines-option.js";

const validCases: Array<{ name: string; raw: string; expected: LineRange }> = [
  {
    name: '"42" maps to { startLine: 42, endLine: 42 }',
    raw: "42",
    expected: { startLine: 42, endLine: 42 },
  },
  {
    name: '" 42 " maps to { startLine: 42, endLine: 42 } after trimming',
    raw: " 42 ",
    expected: { startLine: 42, endLine: 42 },
  },
  {
    name: '"10-40" maps to { startLine: 10, endLine: 40 }',
    raw: "10-40",
    expected: { startLine: 10, endLine: 40 },
  },
  {
    name: '"10-" maps to { startLine: 10, endLine: undefined }',
    raw: "10-",
    expected: { startLine: 10, endLine: undefined },
  },
  {
    name: '"-40" maps to { startLine: undefined, endLine: 40 }',
    raw: "-40",
    expected: { endLine: 40 },
  },
  {
    name: `MAX_READ_LINE ${MAX_READ_LINE} single maps to { startLine: ${MAX_READ_LINE}, endLine: ${MAX_READ_LINE} }`,
    raw: String(MAX_READ_LINE),
    expected: { startLine: MAX_READ_LINE, endLine: MAX_READ_LINE },
  },
  {
    name: `closed range ${MAX_READ_LINE - 1}-${MAX_READ_LINE} maps to { startLine: ${MAX_READ_LINE - 1}, endLine: ${MAX_READ_LINE} }`,
    raw: `${MAX_READ_LINE - 1}-${MAX_READ_LINE}`,
    expected: { startLine: MAX_READ_LINE - 1, endLine: MAX_READ_LINE },
  },
  {
    name: `open-end range ${MAX_READ_LINE}- maps to { startLine: ${MAX_READ_LINE}, endLine: undefined }`,
    raw: `${MAX_READ_LINE}-`,
    expected: { startLine: MAX_READ_LINE },
  },
  {
    name: `open-start range -${MAX_READ_LINE} maps to { startLine: undefined, endLine: ${MAX_READ_LINE} }`,
    raw: `-${MAX_READ_LINE}`,
    expected: { endLine: MAX_READ_LINE },
  },
];

const invalidCases: Array<{ name: string; raw: string }> = [
  { name: "blank input is rejected", raw: "   " },
  { name: 'bare "-" is rejected', raw: "-" },
  { name: 'zero "0" is rejected', raw: "0" },
  { name: 'zero bound "0-5" is rejected', raw: "0-5" },
  { name: 'nonnumeric "abc" is rejected', raw: "abc" },
  { name: 'fractional "1.5" is rejected', raw: "1.5" },
  { name: 'comma-separated "1,2" is rejected', raw: "1,2" },
  {
    name: 'multiple ranges "10-20,30-40" are rejected',
    raw: "10-20,30-40",
  },
  { name: 'reversed range "40-10" is rejected', raw: "40-10" },
  {
    name: `bound ${MAX_READ_LINE + 1} above MAX_READ_LINE is rejected`,
    raw: String(MAX_READ_LINE + 1),
  },
  {
    name: `closed end bound ${MAX_READ_LINE + 1} is rejected`,
    raw: `1-${MAX_READ_LINE + 1}`,
  },
  {
    name: `open-end start bound ${MAX_READ_LINE + 1} is rejected`,
    raw: `${MAX_READ_LINE + 1}-`,
  },
  {
    name: `open-start end bound ${MAX_READ_LINE + 1} is rejected`,
    raw: `-${MAX_READ_LINE + 1}`,
  },
  {
    name: "unsafe integer 9007199254740992 is rejected",
    raw: "9007199254740992",
  },
];

describe("parseLinesOption", () => {
  it.each(validCases)("accepts $name", ({ raw, expected }) => {
    expect(parseLinesOption(raw)).toEqual(expected);
  });

  it.each(invalidCases)("rejects $name", ({ raw }) => {
    expect(() => parseLinesOption(raw)).toThrow();
  });
});

describe("parsePositiveReadLine", () => {
  it('parses "42" with the path range start label as 42', () => {
    expect(parsePositiveReadLine("42", "path range start")).toBe(42);
  });

  it(`accepts MAX_READ_LINE ${MAX_READ_LINE} as a positive bound`, () => {
    expect(
      parsePositiveReadLine(String(MAX_READ_LINE), "path range start"),
    ).toBe(MAX_READ_LINE);
  });

  it('rejects zero "0" as a positive bound', () => {
    expect(() => parsePositiveReadLine("0", "path range start")).toThrow();
  });

  it('rejects "100000000000000000000" with the original quoted path bound', () => {
    expect(() =>
      parsePositiveReadLine("100000000000000000000", "path range start"),
    ).toThrow(
      "path range start: maximum 2147483647. Got '100000000000000000000'.",
    );
  });
});
