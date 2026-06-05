import { describe, expect, it } from "bun:test";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "./pkce.js";

describe("generateCodeVerifier", () => {
  it("returns 43-character base64url string", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique values", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generateCodeChallenge", () => {
  it("returns base64url encoded SHA-256 hash", () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toHaveLength(43);
  });

  it("produces consistent output for same input", () => {
    const verifier = "test-verifier-value";
    const a = generateCodeChallenge(verifier);
    const b = generateCodeChallenge(verifier);
    expect(a).toBe(b);
  });

  it("produces different output for different input", () => {
    const a = generateCodeChallenge("verifier-a");
    const b = generateCodeChallenge("verifier-b");
    expect(a).not.toBe(b);
  });
});

describe("generateState", () => {
  it("returns 64-character hex string", () => {
    const state = generateState();
    expect(state).toHaveLength(64);
    expect(state).toMatch(/^[0-9a-f]+$/);
  });

  it("generates unique values", () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});
