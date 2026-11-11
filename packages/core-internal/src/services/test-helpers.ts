import { mock } from "bun:test";
import type { GitHitsService } from "./githits-service.js";
import type { PackageLifecycle } from "./package-lifecycle.js";
import type { TokenProvider } from "./token-provider.js";

export function createMockGitHitsService(
  impl: Partial<GitHitsService> = {},
): GitHitsService {
  return {
    search: mock(() =>
      Promise.resolve("# Example\n```js\nconsole.log('hi')\n```"),
    ),
    ...impl,
  };
}

export function createMockTokenProvider(
  impl: Partial<TokenProvider> = {},
): TokenProvider {
  return {
    getToken: mock(() => Promise.resolve("mock-access-token")),
    forceRefresh: mock(() => Promise.resolve("mock-refreshed-token")),
    ...impl,
  };
}

/**
 * Simulate a caller cancelling while a follow-up request is in flight: abort
 * `controller`, then settle the request the way fetch does for its signal.
 * When the request's signal did not receive the caller abort, it rejects with
 * a distinct error so tests fail fast instead of waiting for a deadline.
 */
export function abortDuringRequest(
  controller: AbortController,
  reason: unknown,
  init: RequestInit | undefined,
): Promise<never> {
  controller.abort(reason);
  const signal = init?.signal;
  if (!signal?.aborted) {
    return Promise.reject(
      new Error("follow-up request did not receive the caller signal"),
    );
  }
  return Promise.reject(signal.reason);
}

/** Minimal held-evidence projection for unrelated overview wire fixtures. */
export function createMockPackageLifecycle(): PackageLifecycle {
  return {
    findings: [],
    retainedWarnings: [],
    contentSafety: { filtered: false },
    checks: {
      deprecation: { status: "NOT_COLLECTED", reason: null },
      withdrawal: { status: "NOT_COLLECTED", reason: null },
      registryArchival: { status: "NOT_COLLECTED", reason: null },
      repositoryArchival: { status: "NOT_COLLECTED", reason: null },
    },
  };
}
