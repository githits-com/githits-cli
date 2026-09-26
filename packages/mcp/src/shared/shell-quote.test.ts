import { describe, expect, it } from "bun:test";
import { shellQuote, shellQuoteExact } from "./shell-quote.js";

describe("shell quoting", () => {
  it("keeps the existing shellQuote representation unchanged", () => {
    expect(shellQuote("O'Reilly\n")).toBe(`'O'"'"'Reilly\n'`);
  });

  it("uses ANSI-C quoting for exact control-character arguments", () => {
    expect(shellQuoteExact("line\tbreak\n\u0085")).toBe(
      "$'line\\x09break\\x0a\\xc2\\x85'",
    );
    expect(shellQuoteExact("\u0001\u007f\u009f")).toBe(
      "$'\\x01\\x7f\\xc2\\x9f'",
    );
    expect(shellQuoteExact("O'Reilly\\path")).toBe(
      shellQuote("O'Reilly\\path"),
    );
  });
});
