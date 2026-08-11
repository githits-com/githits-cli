import { describe, expect, it, mock } from "bun:test";
import { AuthenticationError } from "@githits/core-internal";
import {
  DEFAULT_ACCOUNTS_URL,
  getAccountsUrl,
  SettingsServiceImpl,
} from "./settings-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const SETTINGS = {
  user_id: "0198a7d0-6750-7ace-a68c-418062117d95",
  default_language_id: null,
  license_mode: "safe" as const,
  blocked_license_ids: [],
  marketing_email_opted_out: false,
  example_generation_limit: null,
  terms_required: true,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SettingsServiceImpl", () => {
  it("gets canonical settings with the active bearer token", async () => {
    const fetchFn = mock(() => Promise.resolve(response(SETTINGS)));
    const service = new SettingsServiceImpl(
      "https://accounts.githits.com",
      createMockTokenProvider({
        getToken: mock(() => Promise.resolve("ghi-static")),
      }),
      fetchFn as unknown as typeof fetch,
    );

    expect(await service.getSettings()).toEqual(SETTINGS);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://accounts.githits.com/functions/v1/settings/me");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer ghi-static",
    });
  });

  it("sends only supplied fields in a PATCH", async () => {
    const fetchFn = mock(() => Promise.resolve(response(SETTINGS)));
    const service = new SettingsServiceImpl(
      DEFAULT_ACCOUNTS_URL,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );

    await service.updateSettings({
      blocked_license_ids: [],
      marketing_email_opted_out: false,
    });

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      blocked_license_ids: [],
      marketing_email_opted_out: false,
    });
  });

  it("posts an empty object to the terms acceptance route", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(response({ ...SETTINGS, terms_required: false })),
    );
    const service = new SettingsServiceImpl(
      DEFAULT_ACCOUNTS_URL,
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    );

    await service.acceptTerms();

    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toEndWith("/functions/v1/settings/me/terms/accept");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("fails closed on malformed settings responses", async () => {
    const service = new SettingsServiceImpl(
      DEFAULT_ACCOUNTS_URL,
      createMockTokenProvider(),
      mock(() =>
        Promise.resolve(response({ ...SETTINGS, terms_required: "no" })),
      ) as unknown as typeof fetch,
    );

    await expect(service.getSettings()).rejects.toThrow(
      "invalid settings response",
    );
  });

  it("ignores additive settings fields from newer account APIs", async () => {
    const service = new SettingsServiceImpl(
      DEFAULT_ACCOUNTS_URL,
      createMockTokenProvider(),
      mock(() =>
        Promise.resolve(response({ ...SETTINGS, future_setting: true })),
      ) as unknown as typeof fetch,
    );

    await expect(service.getSettings()).resolves.toEqual(SETTINGS);
  });

  it("throws AuthenticationError when no active token exists", async () => {
    const fetchFn = mock(() => Promise.resolve(response(SETTINGS)));
    const service = new SettingsServiceImpl(
      DEFAULT_ACCOUNTS_URL,
      createMockTokenProvider({
        getToken: mock(() => Promise.resolve(undefined)),
      }),
      fetchFn as unknown as typeof fetch,
    );

    await expect(service.getSettings()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps server-side 401 responses to AuthenticationError", async () => {
    const service = new SettingsServiceImpl(
      DEFAULT_ACCOUNTS_URL,
      createMockTokenProvider(),
      mock(() =>
        Promise.resolve(response({ error: "unauthorized" }, 401)),
      ) as unknown as typeof fetch,
    );

    await expect(service.getSettings()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });
});

describe("getAccountsUrl", () => {
  it("defaults to the production accounts origin", () => {
    expect(getAccountsUrl({})).toBe(DEFAULT_ACCOUNTS_URL);
  });

  it("supports a secure development override", () => {
    expect(
      getAccountsUrl({
        GITHITS_ACCOUNTS_URL: "https://accounts.example.test",
      }),
    ).toBe("https://accounts.example.test");
  });

  it("rejects insecure non-loopback overrides", () => {
    expect(() =>
      getAccountsUrl({ GITHITS_ACCOUNTS_URL: "http://attacker.test" }),
    ).toThrow("GITHITS_ACCOUNTS_URL");
  });
});
