import { createHash, randomBytes } from "node:crypto";

/**
 * Generate cryptographically random code verifier for PKCE.
 * Returns 43-character base64url string (32 bytes).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Generate S256 code challenge from verifier.
 * Uses SHA-256 hash encoded as base64url.
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generate random state for CSRF protection.
 * Returns 64-character hex string (32 bytes).
 */
export function generateState(): string {
  return randomBytes(32).toString("hex");
}
