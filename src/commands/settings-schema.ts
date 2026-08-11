import { InvalidArgumentError } from "commander";
import { z } from "zod";
import type { Settings, SettingsPatch } from "../services/settings-service.js";

export const SETTINGS_KEYS = [
  "default-language-id",
  "license-mode",
  "blocked-license-ids",
  "marketing-emails",
] as const;
export const CLEARABLE_SETTINGS_KEYS = [
  "default-language-id",
  "blocked-license-ids",
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];
export type ClearableSettingsKey = (typeof CLEARABLE_SETTINGS_KEYS)[number];
export type SettingValue = string | string[] | null;

const SETTINGS_KEY_SCHEMA = z.enum(SETTINGS_KEYS);
const CLEARABLE_SETTINGS_KEY_SCHEMA = z.enum(CLEARABLE_SETTINGS_KEYS);
const UUID_SCHEMA = z.uuid();
const LICENSE_MODE_SCHEMA = z.enum(["safe", "yolo", "custom"]);
const MARKETING_EMAILS_SCHEMA = z.enum(["enabled", "disabled"]);

/** Validate a public CLI setting name before constructing command dependencies. */
export function parseSettingsKey(value: string): SettingsKey {
  const parsed = SETTINGS_KEY_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError(
      `Unknown setting '${value}'. Expected one of: ${SETTINGS_KEYS.join(", ")}.`,
    );
  }
  return parsed.data;
}

/** Validate a setting name for the narrower clear operation. */
export function parseClearableSettingsKey(value: string): ClearableSettingsKey {
  const parsed = CLEARABLE_SETTINGS_KEY_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError(
      `Setting '${value}' cannot be cleared. Expected one of: ${CLEARABLE_SETTINGS_KEYS.join(", ")}.`,
    );
  }
  return parsed.data;
}

/** Convert one typed CLI setting update into the selective account API PATCH. */
export function buildSettingsPatch(
  key: SettingsKey,
  values: string[],
): SettingsPatch {
  switch (key) {
    case "default-language-id":
      return { default_language_id: parseUuid(singleValue(key, values)) };
    case "license-mode":
      return { license_mode: parseLicenseMode(singleValue(key, values)) };
    case "blocked-license-ids":
      return { blocked_license_ids: parseUuidList(key, values) };
    case "marketing-emails":
      return {
        marketing_email_opted_out:
          parseMarketingEmails(singleValue(key, values)) === "disabled",
      };
  }
}

/** Build the explicit empty/default PATCH for settings that support clearing. */
export function buildSettingsClearPatch(
  key: ClearableSettingsKey,
): SettingsPatch {
  switch (key) {
    case "default-language-id":
      return { default_language_id: null };
    case "blocked-license-ids":
      return { blocked_license_ids: [] };
  }
}

/** Read a storage-neutral value for the public CLI setting name. */
export function getSettingValue(
  settings: Settings,
  key: SettingsKey,
): SettingValue {
  switch (key) {
    case "default-language-id":
      return settings.default_language_id;
    case "license-mode":
      return settings.license_mode;
    case "blocked-license-ids":
      return settings.blocked_license_ids;
    case "marketing-emails":
      return settings.marketing_email_opted_out ? "disabled" : "enabled";
  }
}

function singleValue(key: SettingsKey, values: string[]): string {
  if (values.length !== 1) {
    throw new InvalidArgumentError(
      `Setting '${key}' expects exactly one value.`,
    );
  }
  return values[0] ?? "";
}

function parseUuid(value: string): string {
  if (!UUID_SCHEMA.safeParse(value).success) {
    throw new InvalidArgumentError("Expected a UUID.");
  }
  return value;
}

function parseUuidList(key: SettingsKey, values: string[]): string[] {
  if (values.length === 0) {
    throw new InvalidArgumentError(
      `Setting '${key}' expects at least one UUID; use \`githits settings clear ${key}\` for an empty list.`,
    );
  }
  if (values.some((value) => !UUID_SCHEMA.safeParse(value).success)) {
    throw new InvalidArgumentError("Expected one or more UUIDs.");
  }
  return values;
}

function parseLicenseMode(value: string): "safe" | "yolo" | "custom" {
  const parsed = LICENSE_MODE_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError("Expected 'safe', 'yolo', or 'custom'.");
  }
  return parsed.data;
}

function parseMarketingEmails(value: string): "enabled" | "disabled" {
  const parsed = MARKETING_EMAILS_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError("Expected 'enabled' or 'disabled'.");
  }
  return parsed.data;
}
