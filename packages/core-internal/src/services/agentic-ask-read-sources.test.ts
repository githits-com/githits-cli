import { describe, expect, it } from "bun:test";
import { AgenticAskServiceImpl } from "./agentic-ask-service.js";
import displayContract from "./fixtures/ask-display-contract.json";
import { createMockTokenProvider } from "./test-helpers.js";

describe("Ask display contract transport", () => {
  it.each(["cli", "mcp", "url"] as const)(
    "preserves %s display independently of request format",
    async (sourceFormat) => {
      const body = {
        ...displayContract[sourceFormat],
        future_metadata: { nested: [1, false] },
      };
      const service = new AgenticAskServiceImpl(
        "https://api.githits.test",
        createMockTokenProvider(),
        Object.assign(async () => Response.json(body), {
          preconnect: () => undefined,
        }),
      );
      expect(await service.ask({ question: "How?", sourceFormat })).toEqual(
        body,
      );
    },
  );
});
