import { expect, it, mock } from "bun:test";
import { ProviderReauthenticationRequiredError } from "@githits/core-internal";
import { createProviderRecoveryHandler } from "./provider-reauthentication.js";

const URL = "https://dev.githits.com/auth/reauth";

it("opens once, preserving every failure for callers to retry themselves", async () => {
  const open = mock(async () => {});
  const recover = createProviderRecoveryHandler({ open }, true);
  const error = new ProviderReauthenticationRequiredError(URL);
  await expect(recover(error)).rejects.toBe(error);
  await expect(recover(error)).rejects.toBe(error);
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(URL);
});

it("preserves the URL when browser launch fails", async () => {
  const open = mock(async () => {
    throw new Error("headless host");
  });
  const recover = createProviderRecoveryHandler({ open }, true);
  const error = new ProviderReauthenticationRequiredError(URL);
  await expect(recover(error)).rejects.toBe(error);
  expect(error.reauthUrl).toBe(URL);
});

it("does not launch when disabled or for unrelated errors and invalid URLs", async () => {
  const open = mock(async () => {});
  const error = new ProviderReauthenticationRequiredError(URL);
  await expect(
    createProviderRecoveryHandler({ open }, false)(error),
  ).rejects.toBe(error);
  const recover = createProviderRecoveryHandler({ open }, true);
  for (const failure of [
    new Error("network"),
    new ProviderReauthenticationRequiredError("https://evil.test"),
  ]) {
    await expect(recover(failure)).rejects.toBe(failure);
  }
  expect(open).not.toHaveBeenCalled();
});
