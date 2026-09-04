import { describe, expect, it } from "bun:test";
import { buildSearchHitFollowUpCommand } from "./follow-up-command-text.js";
import type { UnifiedSearchHitPayload } from "./unified-search-response.js";

function documentationHit(
  locator: UnifiedSearchHitPayload["locator"],
): UnifiedSearchHitPayload {
  return {
    type: "documentation_page",
    target: "npm:example",
    locator,
  };
}

describe("buildSearchHitFollowUpCommand documentation targets", () => {
  it("shell-quotes publisher URL targets containing spaces and metacharacters", () => {
    const docsReadTarget =
      "https://docs.example.test/guide with spaces;$(echo nope)?q='quoted'&x=*";

    expect(
      buildSearchHitFollowUpCommand(
        documentationHit({
          pageId: "legacy-crawled-id",
          docsReadTarget,
          startLine: 10,
          endLine: 20,
        }),
        "cli",
      ),
    ).toBe(
      `githits docs read 'https://docs.example.test/guide with spaces;$(echo nope)?q='"'"'quoted'"'"'&x=*' --lines 10-20`,
    );
  });

  it("falls back to pageId when discovery omits docsReadTarget", () => {
    expect(
      buildSearchHitFollowUpCommand(
        documentationHit({ pageId: "legacy-crawled-id" }),
      ),
    ).toBe('docs_read page_id="legacy-crawled-id"');
  });
});
