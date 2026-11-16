import { expect, it } from "bun:test";
import {
  getPrimaryExtensions,
  httpRateLimitError,
  httpRateLimitExtensions,
  parsePkgseerErrorDetails,
} from "./pkgseer-error-details.js";

it("preserves precise milliseconds, safe token categories and explicit unselected ref", () => {
  expect(
    parsePkgseerErrorDetails({
      rate_limit_scope: "repository_provider",
      token_source: "app",
      retry_after_ms: 1501,
      retryAfter: 2,
      git_ref: null,
      repo_url: "https://github.com/a/b",
      provider_body: "omitted",
      token_hash: "omitted",
    }),
  ).toEqual({
    rateLimitScope: "repository_provider",
    tokenSource: "app",
    retryAfterMs: 1501,
    retryAfterSeconds: 1.501,
    gitRef: null,
    repoUrl: "https://github.com/a/b",
  });
});
it.each(["app_admission", "operation", "registry"])(
  "keeps %s separate from provider throttling",
  (scope) => {
    expect(
      parsePkgseerErrorDetails({ rate_limit_scope: scope, retryAfter: 2 }),
    ).toEqual({ rateLimitScope: scope, retryAfterSeconds: 2 });
  },
);
it("keeps existing camelCase aliases and zero delay", () => {
  expect(
    parsePkgseerErrorDetails({
      rateLimitScope: "repository_provider",
      tokenSource: "user",
      retryAfterMs: 0,
      repoUrl: "https://github.com/a/b",
      gitRef: "main",
    }),
  ).toEqual({
    rateLimitScope: "repository_provider",
    tokenSource: "user",
    retryAfterMs: 0,
    retryAfterSeconds: 0,
    repoUrl: "https://github.com/a/b",
    gitRef: "main",
  });
});
it("drops invalid and unbounded facts without leaking arbitrary fields", () => {
  expect(
    parsePkgseerErrorDetails({
      rate_limit_scope: "secret",
      token_source: "token-id",
      retry_after_ms: -1,
      retryAfter: NaN,
      git_ref: 123,
      repo_url: "x".repeat(501),
      bearer: "omitted",
    }),
  ).toEqual({});
});
it("retains authentication classification in mixed provider errors", () => {
  const access = { code: "UNAUTHORIZED" };
  expect(
    getPrimaryExtensions([
      {
        extensions: {
          code: "RATE_LIMITED",
          rate_limit_scope: "repository_provider",
        },
      },
      { extensions: access },
    ]),
  ).toBe(access);
});
it("retains the first-error rule when there is no repository-provider failure", () => {
  const first = { code: "NOT_FOUND" };
  expect(
    getPrimaryExtensions([
      { extensions: first },
      { extensions: { code: "TIMEOUT" } },
    ]),
  ).toBe(first);
});

it("reads existing direct API and GraphQL HTTP 429 error shapes", () => {
  const extensions = {
    code: "RATE_LIMITED",
    retryAfter: 2,
    rate_limit_scope: "repository_provider",
  };
  for (const body of [
    extensions,
    { extensions },
    { errors: [{ extensions }] },
  ]) {
    expect(parsePkgseerErrorDetails(httpRateLimitExtensions(body))).toEqual({
      retryAfterSeconds: 2,
      rateLimitScope: "repository_provider",
    });
  }
});

it.each(["UNAUTHORIZED", "FORBIDDEN"])(
  "prefers coded %s over a code-less sibling",
  (code) => {
    const coded = { code };
    expect(
      getPrimaryExtensions([
        { extensions: { hint: "secondary diagnostic" } },
        { extensions: { code: 123 } },
        { extensions: coded },
      ]),
    ).toBe(coded);
  },
);
it("keeps the first nonempty extensions when no sibling has a string code", () => {
  const first = { hint: "first diagnostic" };
  expect(
    getPrimaryExtensions([
      { extensions: {} },
      { extensions: first },
      { extensions: { retryable: false } },
    ]),
  ).toBe(first);
});

it("pairs HTTP provider message with selected facts over competing siblings", () => {
  const provider = {
    code: "RATE_LIMITED",
    rate_limit_scope: "repository_provider",
    token_source: "app",
    retry_after_ms: 1501,
  };
  expect(
    httpRateLimitError({
      errors: [
        { message: "Not found", extensions: { code: "NOT_FOUND" } },
        { message: "Provider\nlimit\u0000reached", extensions: provider },
        { message: "Other error", extensions: { code: "TIMEOUT" } },
      ],
    }),
  ).toEqual({ message: "Provider limit reached", extensions: provider });
});
it("keeps access precedence paired with its own HTTP error message", () => {
  const access = { code: "FORBIDDEN" };
  expect(
    httpRateLimitError({
      errors: [
        { message: "Hint only", extensions: { hint: "retry" } },
        {
          message: "Provider throttled",
          extensions: {
            code: "RATE_LIMITED",
            rate_limit_scope: "repository_provider",
          },
        },
        { message: "Access is restricted", extensions: access },
      ],
    }),
  ).toEqual({ message: "Access is restricted", extensions: access });
});
it("bounds selected HTTP messages and ignores unrelated fields", () => {
  const selected = httpRateLimitError({
    errors: [
      {
        message: "x".repeat(600),
        extensions: { code: "RATE_LIMITED" },
        provider_body: "must-not-survive",
      },
    ],
  });
  expect(selected.message).toHaveLength(500);
  expect(selected.message).toEndWith("...");
  expect(selected).not.toHaveProperty("provider_body");
  expect(
    httpRateLimitError({
      errors: [{ message: 123, extensions: { code: "RATE_LIMITED" } }],
    }).message,
  ).toBeUndefined();
});
