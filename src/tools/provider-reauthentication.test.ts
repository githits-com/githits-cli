import { expect, it } from "bun:test";
import { ProviderReauthenticationRequiredError } from "@githits/core-internal";
import {
  mapAgenticAskError,
  mapGitHitsServiceError,
} from "@githits/mcp/internal";
import {
  createGetExampleTool,
  createResearchTool,
} from "../../packages/mcp/src/tools.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "../commands/format-mapped-error.js";

const URL = "https://dev.githits.com/auth/reauth";
const error = new ProviderReauthenticationRequiredError(URL);

it.each(["text", "json"] as const)(
  "preserves recovery guidance in both MCP tools (%s)",
  async (format) => {
    const fail = async (): Promise<never> => {
      throw error;
    };
    const results = [
      await createGetExampleTool({ search: fail }).handler(
        { query: "test", format },
        {},
      ),
      await createResearchTool({ ask: fail }).handler(
        { question: "How?", format },
        {},
      ),
    ];
    for (const result of results) {
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(URL);
      expect(text).toContain("then retry your request");
      expect(text).not.toContain("githits login");
      if (format === "json") {
        expect(JSON.parse(text)).toMatchObject({
          code: "REAUTH_REQUIRED",
          retryable: false,
          details: { reauthUrl: URL },
        });
      }
    }
  },
);

it("preserves recovery guidance in CLI text and JSON", () => {
  for (const mapped of [
    mapGitHitsServiceError("example", error),
    mapAgenticAskError(error).mapped,
  ]) {
    expect(buildCliMappedErrorPayload(mapped)).toMatchObject({
      code: "REAUTH_REQUIRED",
      retryable: false,
      details: { reauthUrl: URL },
    });
    expect(formatMappedErrorForTerminal(mapped)).toContain(URL);
    expect(formatMappedErrorForTerminal(mapped)).not.toContain("githits login");
  }
});
