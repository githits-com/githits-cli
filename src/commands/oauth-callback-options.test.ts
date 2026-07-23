import { describe, expect, it } from "bun:test";
import { Command, InvalidArgumentError } from "commander";
import {
  addOAuthCallbackOptions,
  CALLBACK_PORT_REQUIREMENT,
  formatRemoteCallbackInstructions,
  isValidOAuthCallbackPort,
  parseOAuthCallbackPort,
} from "./oauth-callback-options.js";

describe("OAuth callback options", () => {
  it("registers the shared browser and callback-port flags", () => {
    const command = addOAuthCallbackOptions(new Command("test"));

    expect(command.options.map((option) => option.long)).toEqual([
      "--no-browser",
      "--port",
    ]);
  });

  for (const [raw, expected] of [
    ["1", 1],
    [" 8765 ", 8765],
    ["65535", 65_535],
  ] as const) {
    it(`parses callback port ${JSON.stringify(raw)}`, () => {
      expect(parseOAuthCallbackPort(raw)).toBe(expected);
    });
  }

  for (const raw of [
    "",
    "0",
    "-1",
    "1.5",
    "8765extra",
    "1e3",
    "65536",
    "Infinity",
  ]) {
    it(`rejects invalid callback port ${JSON.stringify(raw)}`, () => {
      expect(() => parseOAuthCallbackPort(raw)).toThrow(InvalidArgumentError);
      expect(() => parseOAuthCallbackPort(raw)).toThrow(
        CALLBACK_PORT_REQUIREMENT,
      );
    });
  }

  it("validates ports received from programmatic callers", () => {
    expect(isValidOAuthCallbackPort(8765)).toBe(true);
    for (const port of [
      0,
      -1,
      1.5,
      65_536,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(isValidOAuthCallbackPort(port)).toBe(false);
    }
  });

  it("formats forwarding instructions for the selected callback port", () => {
    expect(formatRemoteCallbackInstructions(8765)).toContain(
      "ssh -N -L 8765:127.0.0.1:8765 user@remote-host",
    );
  });
});
