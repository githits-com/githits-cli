import { expect, it } from "bun:test";
import {
  ProviderReauthenticationRequiredError,
  throwIfProviderReauthenticationRequired,
} from "./provider-reauthentication.js";

it.each([
  "https://app.githits.com/auth/reauth",
  "https://dev.githits.com/auth/reauth",
])("preserves trusted recovery URL %s", (reauthUrl) => {
  expect(() =>
    throwIfProviderReauthenticationRequired(
      JSON.stringify({ code: "REAUTH_REQUIRED", reauth_url: reauthUrl }),
    ),
  ).toThrow(ProviderReauthenticationRequiredError);
  expect(new ProviderReauthenticationRequiredError(reauthUrl).reauthUrl).toBe(
    reauthUrl,
  );
});

it.each([
  undefined,
  "https://example.com/auth/reauth",
  "https://app.githits.com/auth/reauth?redirect=evil",
  "https://user@app.githits.com/auth/reauth",
  "http://app.githits.com/auth/reauth",
  "https://app.githits.com/auth/reauth#fragment",
])("keeps recovery typed without exposing an invalid URL: %s", (reauthUrl) => {
  expect(
    new ProviderReauthenticationRequiredError(reauthUrl).reauthUrl,
  ).toBeUndefined();
  expect(() =>
    throwIfProviderReauthenticationRequired(
      JSON.stringify({
        code: "REAUTH_REQUIRED",
        reauth_url: reauthUrl,
      }),
    ),
  ).toThrow(ProviderReauthenticationRequiredError);
});

it.each(["", "not JSON", "null", "[]", '{"code":"AUTH_REQUIRED"}'])(
  "leaves ordinary auth errors alone: %s",
  (body) =>
    expect(() => throwIfProviderReauthenticationRequired(body)).not.toThrow(),
);
