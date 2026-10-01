import { describe, expect, it } from "bun:test";
import { SessionIdConfigError } from "@githits/core-internal";
import { mapAgenticAskError } from "./agentic-ask-error-map.js";
import { mapCodeNavigationError } from "./code-navigation-error-map.js";
import { mapGitHitsServiceError } from "./githits-service-error-map.js";
import { mapGrepError } from "./grep-error-map.js";
import { mapListError } from "./list-error-map.js";
import type { MappedError } from "./mapped-error.js";
import { mapPackageIntelligenceError } from "./package-intelligence-error-map.js";

describe("session configuration error envelopes", () => {
  it.each([
    {
      name: "Ask",
      map: (error: unknown): MappedError => mapAgenticAskError(error).mapped,
    },
    { name: "code navigation", map: mapCodeNavigationError },
    {
      name: "GitHits API",
      map: (error: unknown): MappedError =>
        mapGitHitsServiceError("search", error),
    },
    { name: "grep", map: mapGrepError },
    { name: "list", map: mapListError },
    { name: "package intelligence", map: mapPackageIntelligenceError },
  ])("classifies invalid session configuration for $name", ({ map }) => {
    const error = new SessionIdConfigError();
    expect(map(error)).toEqual({
      code: "INVALID_ARGUMENT",
      message: error.message,
      retryable: false,
    });
  });
});
