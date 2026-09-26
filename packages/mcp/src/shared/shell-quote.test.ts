import { describe, expect, it } from "bun:test";
import { shellQuote, shellQuoteExact } from "./shell-quote.js";

describe("shell quoting", () => {
  it("keeps the existing shellQuote representation unchanged", () => {
    expect(shellQuote("O'Reilly\n")).toBe(`'O'"'"'Reilly\n'`);
  });

  it("uses ANSI-C quoting for exact control-character arguments", () => {
    expect(shellQuoteExact("line\tbreak\n\u0085")).toBe(
      "$'line\\u0009break\\u000a\\u0085'",
    );
    expect(shellQuoteExact("O'Reilly\\path")).toBe(
      shellQuote("O'Reilly\\path"),
    );
  });
});
