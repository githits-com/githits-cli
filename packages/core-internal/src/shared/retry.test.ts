import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { FetchTimeoutError, isFetchTimeoutError } from "./fetch-timeout.js";
import {
  calculateDelay,
  isRetryableError,
  type RetryOptions,
  retryWithBackoff,
} from "./retry.js";

// Mock PkgseerTransportError for testing
class MockPkgseerTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PkgseerTransportError";
  }
}

// Mock error with status
class MockHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Mock error with retryable flag
class MockRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
    (this as unknown as { retryable: boolean }).retryable = true;
  }
}

describe("isRetryableError", () => {
  it("returns true for FetchTimeoutError", () => {
    const error = new FetchTimeoutError(1000);
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns true for PkgseerTransportError", () => {
    const error = new MockPkgseerTransportError("Network failed");
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns true for HTTP 429 (rate limited)", () => {
    const error = new MockHttpError("Rate limited", 429);
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns true for HTTP 500 (server error)", () => {
    const error = new MockHttpError("Server error", 500);
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns true for HTTP 503 (service unavailable)", () => {
    const error = new MockHttpError("Service unavailable", 503);
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns false for HTTP 400 (bad request)", () => {
    const error = new MockHttpError("Bad request", 400);
    expect(isRetryableError(error)).toBe(false);
  });

  it("returns false for HTTP 401 (unauthorized)", () => {
    const error = new MockHttpError("Unauthorized", 401);
    expect(isRetryableError(error)).toBe(false);
  });

  it("returns false for HTTP 404 (not found)", () => {
    const error = new MockHttpError("Not found", 404);
    expect(isRetryableError(error)).toBe(false);
  });

  it("returns true for error with retryable flag", () => {
    const error = new MockRetryableError("Retryable");
    expect(isRetryableError(error)).toBe(true);
  });

  it("returns false for unknown errors", () => {
    const error = new Error("Unknown error");
    expect(isRetryableError(error)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(42)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("calculateDelay", () => {
  it("calculates exponential backoff without jitter", () => {
    const baseDelayMs = 1000;
    const maxDelayMs = 30000;
    const jitter = false;

    // attempt 0: 1000 * 2^0 = 1000
    expect(calculateDelay(0, baseDelayMs, maxDelayMs, jitter)).toBe(1000);
    // attempt 1: 1000 * 2^1 = 2000
    expect(calculateDelay(1, baseDelayMs, maxDelayMs, jitter)).toBe(2000);
    // attempt 2: 1000 * 2^2 = 4000
    expect(calculateDelay(2, baseDelayMs, maxDelayMs, jitter)).toBe(4000);
  });

  it("caps delay at maxDelayMs", () => {
    const baseDelayMs = 1000;
    const maxDelayMs = 5000;
    const jitter = false;

    // attempt 10: 1000 * 2^10 = 1024000, but capped at 5000
    expect(calculateDelay(10, baseDelayMs, maxDelayMs, jitter)).toBe(5000);
  });

  it("adds jitter when enabled", () => {
    const baseDelayMs = 1000;
    const maxDelayMs = 30000;
    const jitter = true;

    // With jitter, delay should be between 500 and 1000 for attempt 0
    // We can't test exact values due to randomness, but we can test range
    const delays = Array.from({ length: 100 }, () =>
      calculateDelay(0, baseDelayMs, maxDelayMs, jitter),
    );

    const minDelay = Math.min(...delays);
    const maxDelay = Math.max(...delays);

    // All delays should be between 500 (50% of 1000) and 1000 (100% of 1000)
    expect(minDelay).toBeGreaterThanOrEqual(500);
    expect(maxDelay).toBeLessThanOrEqual(1000);
  });
});

describe("retryWithBackoff", () => {
  beforeEach(() => {
    // Mock setTimeout to avoid actual delays in tests
    globalThis.setTimeout = mock((_fn: () => void, _ms: number) => 0) as never;
  });

  afterEach(() => {
    // Restore original setTimeout
    globalThis.setTimeout = originalSetTimeout;
  });

  it("succeeds on first attempt without retry", async () => {
    const fn = mock(() => Promise.resolve("success"));

    const result = await retryWithBackoff(fn, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    let callCount = 0;
    const fn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new FetchTimeoutError(1000));
      }
      return Promise.resolve("success after retry");
    });

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 100, // Use small delay for tests
    });

    expect(result).toBe("success after retry");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("fails after maxRetries exceeded", async () => {
    const error = new FetchTimeoutError(1000);
    const fn = mock(() => Promise.reject(error));

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 2,
        baseDelayMs: 100,
      }),
    ).rejects.toThrow(error);

    // Initial attempt + 2 retries = 3 calls total
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const error = new MockHttpError("Bad request", 400);
    const fn = mock(() => Promise.reject(error));

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelayMs: 100,
      }),
    ).rejects.toThrow(error);

    // Only initial attempt, no retries
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry hook with correct parameters", async () => {
    let callCount = 0;
    const fn = mock(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.reject(new FetchTimeoutError(1000));
      }
      return Promise.resolve("success");
    });

    const onRetry = mock(() => {});

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      onRetry,
    });

    expect(result).toBe("success");
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(
      1,
      expect.any(FetchTimeoutError),
      expect.any(Number),
    );
    expect(onRetry).toHaveBeenCalledWith(
      2,
      expect.any(FetchTimeoutError),
      expect.any(Number),
    );
  });

  it("uses custom retryOn function", async () => {
    const error = new MockHttpError("Server error", 500);
    const fn = mock(() => Promise.reject(error));

    // Custom retryOn that never retries
    const retryOn = mock(() => false);

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelayMs: 100,
        retryOn,
      }),
    ).rejects.toThrow(error);

    expect(retryOn).toHaveBeenCalledWith(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects zero maxRetries (no retries)", async () => {
    const error = new FetchTimeoutError(1000);
    const fn = mock(() => Promise.reject(error));

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 0,
        baseDelayMs: 100,
      }),
    ).rejects.toThrow(error);

    // Only initial attempt
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// Store original setTimeout
const originalSetTimeout = globalThis.setTimeout;
