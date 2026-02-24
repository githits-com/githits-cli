import type { KeyringService } from "./keyring-service.js";

/**
 * Conservative chunk size for Windows Credential Manager, which limits
 * password fields to 2560 UTF-16 code units. The 160-char gap provides
 * margin for any encoding overhead in the @napi-rs/keyring binding layer
 * between JS strings and the Windows DPAPI credential store.
 *
 * JS string `.length` counts UTF-16 code units, which matches the Windows
 * limit unit. JWT tokens are base64url ASCII, so each char = one code unit.
 *
 * Pass a different value to the ChunkingKeyringService constructor if
 * another platform has a different limit.
 */
export const WINDOWS_MAX_ENTRY_SIZE = 2400;

/**
 * Sentinel prefix stored in the main key when a value has been chunked.
 * Format: `CHUNKED:<writeId>:<count>`
 *
 * This prefix never collides with real stored data because all values
 * written by KeychainAuthStorage are JSON-serialized objects starting
 * with `{`.
 */
const CHUNKED_PREFIX = "CHUNKED:";

/**
 * Maximum number of chunks allowed per value. Guards against accidentally
 * storing pathologically large data (~240K chars at default chunk size).
 */
const MAX_CHUNK_COUNT = 100;

/**
 * Build the chunk key for a given account, write ID, and chunk index.
 * Format: `{account}:chunk:{writeId}:{index}`
 */
export function chunkKey(
  account: string,
  writeId: string,
  index: number,
): string {
  return `${account}:chunk:${writeId}:${index}`;
}

/**
 * Parse a chunked sentinel value into its writeId and chunk count.
 * Returns null if the value is not a valid sentinel (non-sentinel values,
 * malformed counts, zero/negative counts).
 */
export function parseChunkedSentinel(
  value: string,
): { writeId: string; count: number } | null {
  if (!value.startsWith(CHUNKED_PREFIX)) return null;
  const rest = value.slice(CHUNKED_PREFIX.length);
  const colonIndex = rest.indexOf(":");
  if (colonIndex === -1) return null;
  const writeId = rest.slice(0, colonIndex);
  if (writeId.length === 0) return null;
  const countStr = rest.slice(colonIndex + 1);
  const count = Number(countStr);
  if (!Number.isInteger(count) || count <= 0) return null;
  return { writeId, count };
}

/**
 * Split a string into chunks of at most `maxSize` characters.
 * Always returns at least one element (empty string produces `[""]`).
 */
export function splitIntoChunks(value: string, maxSize: number): string[] {
  if (value.length === 0) return [""];
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += maxSize) {
    chunks.push(value.slice(offset, offset + maxSize));
  }
  return chunks;
}

/**
 * Generate a short random write ID for namespacing chunk keys.
 * Returns a 6-character alphanumeric string. Provides sufficient
 * uniqueness for sequential writes by a single-user CLI.
 */
export function generateWriteId(): string {
  let id: string;
  do {
    id = Math.random().toString(36).slice(2, 8);
  } while (id.length < 6);
  return id;
}

/**
 * KeyringService decorator that transparently chunks values exceeding a
 * platform size limit (Windows Credential Manager's 2560 UTF-16 char cap).
 *
 * Values under the limit are stored directly (backward compatible with
 * pre-chunking versions). Values over the limit are split into numbered
 * chunks with a `CHUNKED:<writeId>:<count>` sentinel in the main key.
 *
 * Each write uses a unique writeId to namespace chunk keys, ensuring
 * crash safety: old sentinel+chunks remain valid until the new sentinel
 * overwrites the main key. Old chunks are cleaned up after the new
 * sentinel is committed.
 *
 * Intended for Windows only — wired conditionally in container.ts.
 */
export class ChunkingKeyringService implements KeyringService {
  constructor(
    private readonly inner: KeyringService,
    private readonly maxEntrySize: number = WINDOWS_MAX_ENTRY_SIZE,
  ) {}

  getPassword(service: string, account: string): string | null {
    const value = this.inner.getPassword(service, account);
    if (value === null) return null;
    if (!value.startsWith(CHUNKED_PREFIX)) return value;

    const sentinel = parseChunkedSentinel(value);
    if (sentinel === null) return null;

    const chunks: string[] = [];
    for (let i = 0; i < sentinel.count; i++) {
      const chunk = this.inner.getPassword(
        service,
        chunkKey(account, sentinel.writeId, i),
      );
      if (chunk === null) {
        console.error(
          `Warning: Incomplete chunked keychain entry for "${account}" (missing chunk ${i} of ${sentinel.count}). Treating as missing.`,
        );
        return null;
      }
      chunks.push(chunk);
    }
    return chunks.join("");
  }

  setPassword(service: string, account: string, password: string): void {
    // Read old sentinel before writing so we can clean up old chunks afterward.
    const oldValue = this.readOldSentinel(service, account);

    if (password.length <= this.maxEntrySize) {
      // Value fits in a single entry — write directly.
      this.inner.setPassword(service, account, password);
    } else {
      // Split into chunks with a new writeId namespace.
      const chunks = splitIntoChunks(password, this.maxEntrySize);
      if (chunks.length > MAX_CHUNK_COUNT) {
        throw new Error(
          `Value requires ${chunks.length} chunks, exceeding maximum of ${MAX_CHUNK_COUNT}. ` +
            `This likely indicates a bug — credential data should not be this large.`,
        );
      }
      const writeId = generateWriteId();

      // Write chunks first — if we crash here, the old sentinel still
      // points to the old (valid) chunks.
      for (const [i, chunk] of chunks.entries()) {
        this.inner.setPassword(service, chunkKey(account, writeId, i), chunk);
      }

      // Commit: write sentinel last so reads are atomic.
      this.inner.setPassword(
        service,
        account,
        `${CHUNKED_PREFIX}${writeId}:${chunks.length}`,
      );
    }

    // Best-effort cleanup of old chunks (if any).
    if (oldValue !== null) {
      this.deleteChunkEntries(service, account, oldValue);
    }
  }

  deletePassword(service: string, account: string): boolean {
    // Read sentinel before deleting so we know which chunks to clean up.
    const oldValue = this.readOldSentinel(service, account);
    if (oldValue !== null) {
      this.deleteChunkEntries(service, account, oldValue);
    }
    return this.inner.deletePassword(service, account);
  }

  /**
   * Read the current main key value and parse it as a sentinel.
   * Returns the parsed sentinel if the value is chunked, null otherwise.
   * Swallows errors from the inner service since this is used for
   * best-effort cleanup.
   */
  private readOldSentinel(
    service: string,
    account: string,
  ): { writeId: string; count: number } | null {
    try {
      const value = this.inner.getPassword(service, account);
      if (value === null) return null;
      return parseChunkedSentinel(value);
    } catch {
      return null;
    }
  }

  /**
   * Delete chunk entries for a given sentinel. Best-effort: continues
   * on individual failures since orphaned chunks are harmless and will
   * be cleaned up on the next write or delete.
   */
  private deleteChunkEntries(
    service: string,
    account: string,
    sentinel: { writeId: string; count: number },
  ): void {
    for (let i = 0; i < sentinel.count; i++) {
      try {
        this.inner.deletePassword(
          service,
          chunkKey(account, sentinel.writeId, i),
        );
      } catch {
        // Best-effort cleanup: orphaned chunks are harmless
      }
    }
  }
}
