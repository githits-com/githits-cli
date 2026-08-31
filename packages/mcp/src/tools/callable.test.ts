import { describe, expect, it, mock } from "bun:test";
import type { GitHitsService } from "@githits/core-internal";
import { z } from "zod";
import {
  ApiRateLimitError,
  AuthenticationError,
  FetchTimeoutError,
  TermsAcceptanceRequiredError,
} from "../tools.js";
import { toCallableTool } from "./callable.js";
import { createGetExampleTool, type GetExampleService } from "./get-example.js";
import { QUICK_START_PREREQUISITE } from "./quick-start.js";
import {
  BOUNDED_WRITE_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
} from "./types.js";

describe("toCallableTool", () => {
  it("emits an input schema with defaults, descriptions, and optional fields", () => {
    const service: GetExampleService = {
      search: async () => "result",
    };
    const callable = toCallableTool(createGetExampleTool(service));
    const schema = callable.inputSchema as {
      required?: string[];
      properties?: Record<string, Record<string, unknown>>;
      additionalProperties?: boolean;
    };

    expect(schema.required).toEqual(["query"]);
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.properties?.query).toMatchObject({
      type: "string",
      minLength: 1,
      description:
        "Natural-language example-search query for canonical code examples.",
    });
    expect(schema.properties?.language).toMatchObject({
      type: "string",
      minLength: 1,
    });
    expect(schema.properties?.format).toMatchObject({
      type: "string",
      enum: ["text-v1", "text", "json"],
      default: "text-v1",
    });
    expect(callable.description).not.toContain(QUICK_START_PREREQUISITE);
  });

  it("validates before calling the service and strips unknown input", async () => {
    const search = mock(() => Promise.resolve("result"));
    const service: GetExampleService = { search };
    const callable = toCallableTool(createGetExampleTool(service));

    await expect(callable.execute({ language: "typescript" })).rejects.toThrow(
      "Invalid input",
    );
    expect(search).not.toHaveBeenCalled();

    await callable.execute({ query: "hello", unknown: "ignored" });
    expect(search).toHaveBeenCalledWith({
      query: "hello",
      language: undefined,
      licenseMode: undefined,
      includeExplanation: false,
    });
  });

  it("applies schema defaults before invoking a handler", async () => {
    const handler = mock(async (args: { format: "text-v1" | "json" }) =>
      textResult(args.format),
    );
    const schema = {
      format: z.enum(["text-v1", "json"]).default("text-v1"),
    };
    const definition: ToolDefinition<
      { format: "text-v1" | "json" },
      typeof schema
    > = {
      name: "default-test",
      description: "default test",
      schema,
      annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
      handler,
    };
    const callable = toCallableTool(definition);

    await expect(callable.execute({})).resolves.toEqual({
      content: [{ type: "text", text: "text-v1" }],
    });
    expect(handler).toHaveBeenCalledWith(
      { format: "text-v1" },
      { authAction: "Authenticate with GitHits, then retry." },
    );
  });

  it("maps public service errors with host-neutral callable remediation", async () => {
    const errorCases = [
      {
        error: new AuthenticationError(),
        payload: {
          error: "Authentication required.",
          code: "AUTH_REQUIRED",
          retryable: false,
          details: {
            authSource: "local",
            action: "Authenticate with GitHits, then retry.",
          },
        },
      },
      {
        error: new ApiRateLimitError("Request rate limited.", 17),
        payload: {
          error: "Request rate limited.",
          code: "RATE_LIMITED",
          retryable: true,
          details: { status: 429, retryAfterSeconds: 17 },
        },
      },
      {
        error: new FetchTimeoutError(2_500),
        payload: {
          error: "Failed to get example: Request timed out after 2500ms.",
          code: "TIMEOUT",
          retryable: true,
          details: { timeoutMs: 2_500 },
        },
      },
      {
        error: new TermsAcceptanceRequiredError(),
        payload: {
          error:
            "Terms acceptance required. Review and accept the current terms at https://app.githits.com/settings/privacy, then retry.",
          code: "TERMS_ACCEPTANCE_REQUIRED",
          retryable: false,
          details: {
            action: "https://app.githits.com/settings/privacy",
            termsUrl: "https://githits.com/legal/terms-of-service/",
            acceptanceUrl: "https://app.githits.com/settings/privacy",
          },
        },
      },
    ] as const;

    for (const { error, payload } of errorCases) {
      const service: GetExampleService = {
        search: async () => {
          throw error;
        },
      };
      const result = await toCallableTool(
        createGetExampleTool(service),
      ).execute({ query: "hello" });

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify(payload) }],
        isError: true,
      });
    }

    const authPayload = errorCases[0]?.payload;
    expect(JSON.stringify(authPayload)).not.toContain("githits login");
    expect(JSON.stringify(authPayload)).not.toContain("GITHITS_API_TOKEN");
    const termsPayload = errorCases[3]?.payload;
    expect(JSON.stringify(termsPayload)).not.toContain("settings terms accept");
  });

  it("keeps success and structured error results parity with direct tools", async () => {
    const successService: GetExampleService = {
      search: async () => "# Result",
    };
    const directSuccess = await createGetExampleTool(successService).handler({
      query: "hello",
    });
    const callableSuccess = await toCallableTool(
      createGetExampleTool(successService),
    ).execute({ query: "hello" });
    expect(callableSuccess).toEqual(directSuccess);

    const errorService: GetExampleService = {
      search: async () => {
        throw new Error("Network error");
      },
    };
    const directError = await createGetExampleTool(errorService).handler({
      query: "hello",
    });
    const callableError = await toCallableTool(
      createGetExampleTool(errorService),
    ).execute({ query: "hello" });
    expect(callableError).toEqual(directError);
  });

  it("forwards the signal and preserves cancellation rejection", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    const search = mock(
      async (_params: unknown, options?: { signal?: AbortSignal }) => {
        expect(options?.signal).toBe(controller.signal);
        controller.abort(reason);
        throw reason;
      },
    );
    const service: GetExampleService = { search };
    const callable = toCallableTool(createGetExampleTool(service));

    await expect(
      callable.execute({ query: "hello" }, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("accepts the existing GitHitsService structurally", () => {
    const existingService = {} as GitHitsService;
    const acceptsGetExampleService = (
      service: GetExampleService,
    ): GetExampleService => service;

    expect(acceptsGetExampleService(existingService)).toBe(existingService);
  });
});
