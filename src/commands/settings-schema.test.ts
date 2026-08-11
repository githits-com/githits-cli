import { describe, expect, it } from "bun:test";
import type { Settings } from "../services/settings-service.js";
import {
  buildSettingsClearPatch,
  buildSettingsPatch,
  getSettingValue,
  parseClearableSettingsKey,
  parseSettingsKey,
} from "./settings-schema.js";

const FIRST_UUID = "0198a7d0-6750-7ace-a68c-418062117d95";
const SECOND_UUID = "0198a7d0-6750-7ace-a68c-418062117d96";

const SETTINGS: Settings = {
  user_id: FIRST_UUID,
  default_language_id: null,
  license_mode: "safe",
  blocked_license_ids: [SECOND_UUID],
  marketing_email_opted_out: true,
  example_generation_limit: 25,
  terms_required: false,
};

describe("settings CLI schema", () => {
  it("maps friendly scalar values to storage fields", () => {
    expect(buildSettingsPatch("license-mode", ["custom"])).toEqual({
      license_mode: "custom",
    });
    expect(buildSettingsPatch("marketing-emails", ["disabled"])).toEqual({
      marketing_email_opted_out: true,
    });
    expect(buildSettingsPatch("marketing-emails", ["enabled"])).toEqual({
      marketing_email_opted_out: false,
    });
  });

  it("treats blocked license IDs as an atomic list replacement", () => {
    expect(
      buildSettingsPatch("blocked-license-ids", [FIRST_UUID, SECOND_UUID]),
    ).toEqual({ blocked_license_ids: [FIRST_UUID, SECOND_UUID] });
  });

  it("uses clear for nullable and empty-list values", () => {
    expect(buildSettingsClearPatch("default-language-id")).toEqual({
      default_language_id: null,
    });
    expect(buildSettingsClearPatch("blocked-license-ids")).toEqual({
      blocked_license_ids: [],
    });
  });

  it("rejects unknown keys and invalid values before an API call", () => {
    expect(() => parseSettingsKey("marketing-email-opted-out")).toThrow(
      "Unknown setting",
    );
    expect(() => buildSettingsPatch("license-mode", ["unsafe"])).toThrow(
      "Expected 'safe', 'yolo', or 'custom'",
    );
    expect(() => buildSettingsPatch("blocked-license-ids", [])).toThrow(
      "settings clear blocked-license-ids",
    );
    expect(() => parseClearableSettingsKey("marketing-emails")).toThrow(
      "cannot be cleared",
    );
  });

  it("presents negative storage booleans as positive domain values", () => {
    expect(getSettingValue(SETTINGS, "marketing-emails")).toBe("disabled");
    expect(getSettingValue(SETTINGS, "blocked-license-ids")).toEqual([
      SECOND_UUID,
    ]);
  });
});
