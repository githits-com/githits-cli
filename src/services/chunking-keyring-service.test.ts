import { describe, expect, it, mock } from "bun:test";
import {
  ChunkingKeyringService,
  chunkKey,
  generateWriteId,
  parseChunkedSentinel,
  splitIntoChunks,
} from "./chunking-keyring-service.js";
import type { KeyringService } from "./keyring-service.js";
import { createMockKeyringService } from "./test-helpers.js";

/**
 * In-memory KeyringService for integration-style tests where
 * getPassword must reflect prior setPassword calls.
 * Uses composite key (service + account) for correctness.
 */
function createInMemoryKeyring(): KeyringService {
  const store = new Map<string, string>();
  const compositeKey = (service: string, account: string): string =>
    `${service}::${account}`;
  return {
    getPassword: (service: string, account: string) =>
      store.get(compositeKey(service, account)) ?? null,
    setPassword: (service: string, account: string, password: string) => {
      store.set(compositeKey(service, account), password);
    },
    deletePassword: (service: string, account: string) =>
      store.delete(compositeKey(service, account)),
  };
}

describe("pure helpers", () => {
  describe("splitIntoChunks", () => {
    it("splits a string into chunks of maxSize", () => {
      const result = splitIntoChunks("abcdefghij", 3);
      expect(result).toEqual(["abc", "def", "ghi", "j"]);
    });

    it("returns single-element array for string under limit", () => {
      const result = splitIntoChunks("short", 100);
      expect(result).toEqual(["short"]);
    });

    it("returns single chunk for string exactly at limit", () => {
      const value = "a".repeat(10);
      const result = splitIntoChunks(value, 10);
      expect(result).toEqual([value]);
    });

    it("returns single-element array with empty string for empty input", () => {
      const result = splitIntoChunks("", 10);
      expect(result).toEqual([""]);
    });
  });

  describe("parseChunkedSentinel", () => {
    it("extracts writeId and count from valid sentinel", () => {
      const result = parseChunkedSentinel("CHUNKED:abc123:3");
      expect(result).toEqual({ writeId: "abc123", count: 3 });
    });

    it("returns null for non-sentinel string", () => {
      expect(parseChunkedSentinel('{"accessToken":"abc"}')).toBeNull();
    });

    it("returns null for sentinel missing count", () => {
      expect(parseChunkedSentinel("CHUNKED:abc")).toBeNull();
    });

    it("returns null for sentinel with non-numeric count", () => {
      expect(parseChunkedSentinel("CHUNKED:abc:xyz")).toBeNull();
    });

    it("returns null for sentinel with zero count", () => {
      expect(parseChunkedSentinel("CHUNKED:abc:0")).toBeNull();
    });

    it("returns null for sentinel with negative count", () => {
      expect(parseChunkedSentinel("CHUNKED:abc:-1")).toBeNull();
    });

    it("returns null for sentinel with empty writeId", () => {
      expect(parseChunkedSentinel("CHUNKED::3")).toBeNull();
    });
  });

  describe("chunkKey", () => {
    it("generates correct key format", () => {
      expect(chunkKey("v1:tokens:https://mcp.githits.com", "abc123", 2)).toBe(
        "v1:tokens:https://mcp.githits.com:chunk:abc123:2",
      );
    });
  });

  describe("generateWriteId", () => {
    it("returns a 6-character alphanumeric string", () => {
      const id = generateWriteId();
      expect(id).toHaveLength(6);
      expect(id).toMatch(/^[a-z0-9]+$/);
    });

    it("generates different values on successive calls", () => {
      const ids = new Set(Array.from({ length: 10 }, () => generateWriteId()));
      expect(ids.size).toBeGreaterThan(1);
    });
  });
});

describe("ChunkingKeyringService", () => {
  const SERVICE = "githits";
  const ACCOUNT = "v1:tokens:https://mcp.githits.com";

  describe("getPassword", () => {
    it("returns null when inner returns null", () => {
      const inner = createMockKeyringService();
      const chunking = new ChunkingKeyringService(inner);

      expect(chunking.getPassword(SERVICE, ACCOUNT)).toBeNull();
    });

    it("returns value directly when not chunked", () => {
      const json = '{"accessToken":"abc"}';
      const inner = createMockKeyringService({
        getPassword: mock(() => json),
      });
      const chunking = new ChunkingKeyringService(inner);

      expect(chunking.getPassword(SERVICE, ACCOUNT)).toBe(json);
    });

    it("reassembles chunked value from multiple entries", () => {
      const store = new Map<string, string>();
      store.set(ACCOUNT, "CHUNKED:wid123:3");
      store.set(`${ACCOUNT}:chunk:wid123:0`, "aaa");
      store.set(`${ACCOUNT}:chunk:wid123:1`, "bbb");
      store.set(`${ACCOUNT}:chunk:wid123:2`, "ccc");
      const inner = createMockKeyringService({
        getPassword: mock(
          (_s: string, account: string) => store.get(account) ?? null,
        ),
      });
      const chunking = new ChunkingKeyringService(inner);

      expect(chunking.getPassword(SERVICE, ACCOUNT)).toBe("aaabbbccc");
    });

    it("returns null when a chunk is missing", () => {
      const store = new Map<string, string>();
      store.set(ACCOUNT, "CHUNKED:wid123:2");
      store.set(`${ACCOUNT}:chunk:wid123:0`, "aaa");
      // chunk:1 missing
      const inner = createMockKeyringService({
        getPassword: mock(
          (_s: string, account: string) => store.get(account) ?? null,
        ),
      });
      const chunking = new ChunkingKeyringService(inner);

      const originalError = console.error;
      console.error = mock(() => {});
      try {
        const result = chunking.getPassword(SERVICE, ACCOUNT);
        expect(result).toBeNull();
      } finally {
        console.error = originalError;
      }
    });

    it("logs warning when a chunk is missing", () => {
      const store = new Map<string, string>();
      store.set(ACCOUNT, "CHUNKED:wid123:2");
      store.set(`${ACCOUNT}:chunk:wid123:0`, "aaa");
      const inner = createMockKeyringService({
        getPassword: mock(
          (_s: string, account: string) => store.get(account) ?? null,
        ),
      });
      const chunking = new ChunkingKeyringService(inner);

      const errorFn = mock(() => {});
      const originalError = console.error;
      console.error = errorFn;
      try {
        chunking.getPassword(SERVICE, ACCOUNT);
      } finally {
        console.error = originalError;
      }

      expect(errorFn).toHaveBeenCalledTimes(1);
      const firstCallArg = (errorFn.mock.calls as unknown[][])[0]?.[0];
      expect(firstCallArg).toContain("Incomplete chunked");
    });

    it("returns null for invalid sentinel format", () => {
      const inner = createMockKeyringService({
        getPassword: mock(() => "CHUNKED:badformat"),
      });
      const chunking = new ChunkingKeyringService(inner);

      expect(chunking.getPassword(SERVICE, ACCOUNT)).toBeNull();
    });
  });

  describe("setPassword", () => {
    it("stores directly when value fits within limit", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 100);

      chunking.setPassword(SERVICE, ACCOUNT, "small-value");

      expect(inner.getPassword(SERVICE, ACCOUNT)).toBe("small-value");
    });

    it("chunks large values into multiple entries", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 10);
      const value = "a".repeat(25);

      chunking.setPassword(SERVICE, ACCOUNT, value);

      const sentinel = inner.getPassword(SERVICE, ACCOUNT);
      expect(sentinel).toMatch(/^CHUNKED:[a-z0-9]+:3$/);

      // Parse sentinel to find writeId and verify chunks
      const parsed = parseChunkedSentinel(sentinel as string);
      expect(parsed).not.toBeNull();
      expect(
        inner.getPassword(SERVICE, chunkKey(ACCOUNT, parsed!.writeId, 0)),
      ).toBe("a".repeat(10));
      expect(
        inner.getPassword(SERVICE, chunkKey(ACCOUNT, parsed!.writeId, 1)),
      ).toBe("a".repeat(10));
      expect(
        inner.getPassword(SERVICE, chunkKey(ACCOUNT, parsed!.writeId, 2)),
      ).toBe("a".repeat(5));
    });

    it("cleans up old chunks when replacing chunked value with small value", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 10);

      // Write a chunked value
      chunking.setPassword(SERVICE, ACCOUNT, "a".repeat(25));
      const oldSentinel = parseChunkedSentinel(
        inner.getPassword(SERVICE, ACCOUNT) as string,
      );
      expect(oldSentinel).not.toBeNull();

      // Overwrite with a small value
      chunking.setPassword(SERVICE, ACCOUNT, "tiny");

      expect(inner.getPassword(SERVICE, ACCOUNT)).toBe("tiny");
      // Old chunks should be cleaned up
      for (let i = 0; i < oldSentinel!.count; i++) {
        expect(
          inner.getPassword(
            SERVICE,
            chunkKey(ACCOUNT, oldSentinel!.writeId, i),
          ),
        ).toBeNull();
      }
    });

    it("cleans up old chunks when replacing with new chunked value", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 10);

      // Write 3-chunk value
      chunking.setPassword(SERVICE, ACCOUNT, "a".repeat(25));
      const oldSentinel = parseChunkedSentinel(
        inner.getPassword(SERVICE, ACCOUNT) as string,
      );

      // Overwrite with 2-chunk value
      chunking.setPassword(SERVICE, ACCOUNT, "b".repeat(15));
      const newSentinel = parseChunkedSentinel(
        inner.getPassword(SERVICE, ACCOUNT) as string,
      );
      expect(newSentinel!.count).toBe(2);

      // Old chunks should be cleaned up
      for (let i = 0; i < oldSentinel!.count; i++) {
        expect(
          inner.getPassword(
            SERVICE,
            chunkKey(ACCOUNT, oldSentinel!.writeId, i),
          ),
        ).toBeNull();
      }
      // New chunks should exist
      expect(
        inner.getPassword(SERVICE, chunkKey(ACCOUNT, newSentinel!.writeId, 0)),
      ).toBe("b".repeat(10));
      expect(
        inner.getPassword(SERVICE, chunkKey(ACCOUNT, newSentinel!.writeId, 1)),
      ).toBe("b".repeat(5));
    });

    it("throws when chunk count exceeds maximum", () => {
      const inner = createInMemoryKeyring();
      // maxEntrySize=1 with a 101-char string would need 101 chunks
      const chunking = new ChunkingKeyringService(inner, 1);

      expect(() =>
        chunking.setPassword(SERVICE, ACCOUNT, "x".repeat(101)),
      ).toThrow(/exceeding maximum of 100/);
    });

    it("uses different writeId per call", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 10);

      chunking.setPassword(SERVICE, ACCOUNT, "a".repeat(15));
      const first = parseChunkedSentinel(
        inner.getPassword(SERVICE, ACCOUNT) as string,
      );

      chunking.setPassword(SERVICE, ACCOUNT, "b".repeat(15));
      const second = parseChunkedSentinel(
        inner.getPassword(SERVICE, ACCOUNT) as string,
      );

      expect(first!.writeId).not.toBe(second!.writeId);
    });

    it("preserves old value when chunk write fails mid-write", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 10);

      // Establish a known initial small value
      chunking.setPassword(SERVICE, ACCOUNT, "old-value");
      expect(inner.getPassword(SERVICE, ACCOUNT)).toBe("old-value");

      // Create a faulty wrapper that throws on the 2nd setPassword call
      // (1st call reads old sentinel via getPassword, so 2nd call is
      // the first chunk write)
      let writeCount = 0;
      const originalSet = inner.setPassword.bind(inner);
      inner.setPassword = (
        service: string,
        account: string,
        password: string,
      ) => {
        writeCount++;
        if (writeCount === 2) throw new Error("simulated disk full");
        originalSet(service, account, password);
      };

      // The chunked write should throw
      expect(() =>
        chunking.setPassword(SERVICE, ACCOUNT, "x".repeat(25)),
      ).toThrow("simulated disk full");

      // Old value should still be readable (sentinel was never written)
      // Restore original setPassword for the read
      inner.setPassword = originalSet;
      expect(chunking.getPassword(SERVICE, ACCOUNT)).toBe("old-value");
    });
  });

  describe("deletePassword", () => {
    it("deletes non-chunked value", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 100);
      chunking.setPassword(SERVICE, ACCOUNT, "small");

      const result = chunking.deletePassword(SERVICE, ACCOUNT);

      expect(result).toBe(true);
      expect(inner.getPassword(SERVICE, ACCOUNT)).toBeNull();
    });

    it("deletes chunked value and all its chunks", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 10);
      chunking.setPassword(SERVICE, ACCOUNT, "a".repeat(25));
      const sentinel = parseChunkedSentinel(
        inner.getPassword(SERVICE, ACCOUNT) as string,
      );

      const result = chunking.deletePassword(SERVICE, ACCOUNT);

      expect(result).toBe(true);
      expect(inner.getPassword(SERVICE, ACCOUNT)).toBeNull();
      for (let i = 0; i < sentinel!.count; i++) {
        expect(
          inner.getPassword(SERVICE, chunkKey(ACCOUNT, sentinel!.writeId, i)),
        ).toBeNull();
      }
    });

    it("returns false when main key does not exist", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner);

      expect(chunking.deletePassword(SERVICE, ACCOUNT)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("does not chunk value exactly at MAX_CHUNK_SIZE boundary", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 100);
      const value = "x".repeat(100);

      chunking.setPassword(SERVICE, ACCOUNT, value);

      // Should be stored directly, not as a sentinel
      expect(inner.getPassword(SERVICE, ACCOUNT)).toBe(value);
    });

    it("chunks value one character over MAX_CHUNK_SIZE", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 100);
      const value = "x".repeat(101);

      chunking.setPassword(SERVICE, ACCOUNT, value);

      const sentinel = inner.getPassword(SERVICE, ACCOUNT);
      expect(sentinel).toMatch(/^CHUNKED:/);
      const parsed = parseChunkedSentinel(sentinel as string);
      expect(parsed?.count).toBe(2);
    });

    it("round-trips a chunked value through set and get", () => {
      const inner = createInMemoryKeyring();
      const chunking = new ChunkingKeyringService(inner, 10);
      const value = `{"accessToken":"${"a".repeat(50)}","refreshToken":"b"}`;

      chunking.setPassword(SERVICE, ACCOUNT, value);
      const result = chunking.getPassword(SERVICE, ACCOUNT);

      expect(result).toBe(value);
    });
  });
});
