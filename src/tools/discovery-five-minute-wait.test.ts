import { describe, expect, it, mock, spyOn } from "bun:test";
import { CodeNavigationServiceImpl } from "@githits/core-internal";
import { createMockTokenProvider } from "../../packages/core-internal/src/services/test-helpers.js";
import { searchAction, searchStatusAction } from "../commands/search.js";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

for (const operation of ["search", "search_status"] as const) {
  describe(`${operation} five-minute wait`, () => {
    it("accepts 300000 ms but rejects longer or invalid MCP waits", () => {
      const schema = createParityMcpTool(operation).schema.wait_timeout_ms;
      if (!schema) throw new Error("missing wait schema");
      for (const wait of [0, 60_001, 300_000])
        expect(schema.safeParse(wait).success).toBe(true);
      for (const wait of [-1, 300_001, 1.5])
        expect(schema.safeParse(wait).success).toBe(false);
    });

    it("preserves caller cancellation through the tool and real service", async () => {
      const controller = new AbortController();
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const fetchFn = mock(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            started();
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      );
      const service = new CodeNavigationServiceImpl(
        "https://backend.example.com",
        createMockTokenProvider(),
        fetchFn as unknown as typeof fetch,
      );
      const tool = createParityMcpTool(operation, {
        codeNavigationService: service,
      });
      const args =
        operation === "search"
          ? { target: "npm:express", query: "router" }
          : { search_ref: "ref" };
      const pending = tool.handler(
        { ...args, wait_timeout_ms: 300_000 },
        { signal: controller.signal },
      );
      await ready;
      controller.abort(new Error("caller canceled discovery"));
      await expect(pending).rejects.toBe(controller.signal.reason);
    });

    it("converts CLI 300 seconds and MCP 300000 ms into the same service budget", async () => {
      const call = mock(async () => defaultUnifiedSearchOutcome);
      const service = createMockCodeNavigationService({
        search: call,
        searchStatus: call,
      });
      const deps = {
        codeNavigationService: service,
        codeNavigationUrl: "https://backend.example.com",
        hasValidToken: true,
        mcpUrl: "https://mcp.example.com",
      };
      const log = spyOn(console, "log").mockImplementation(() => {});
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("unexpected CLI exit");
      });
      try {
        if (operation === "search")
          await searchAction(
            "router",
            { in: ["npm:express"], wait: "300", json: true },
            deps,
          );
        else await searchStatusAction("ref", { wait: "300", json: true }, deps);
      } finally {
        log.mockRestore();
        error.mockRestore();
        exit.mockRestore();
      }
      const cliArgs = call.mock.calls[0] as unknown as unknown[];
      expect(
        operation === "search"
          ? (cliArgs[0] as { waitTimeoutMs: number }).waitTimeoutMs
          : cliArgs[1],
      ).toBe(300_000);
      call.mockClear();
      const tool = createParityMcpTool(operation, {
        codeNavigationService: service,
      });
      const args =
        operation === "search"
          ? { target: "npm:express", query: "router" }
          : { search_ref: "ref" };
      const controller = new AbortController();
      const result = await tool.handler(
        { ...args, wait_timeout_ms: 300_000, format: "json" },
        { signal: controller.signal },
      );
      expect(result.isError).toBeUndefined();
      const mcpArgs = call.mock.calls[0] as unknown as unknown[];
      expect(
        (mcpArgs[operation === "search" ? 1 : 2] as { signal?: AbortSignal })
          .signal,
      ).toBe(controller.signal);
      expect(
        operation === "search"
          ? (mcpArgs[0] as { waitTimeoutMs: number }).waitTimeoutMs
          : mcpArgs[1],
      ).toBe(300_000);
    });
  });
}
