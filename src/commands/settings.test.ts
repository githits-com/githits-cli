import { describe, expect, it, mock, spyOn } from "bun:test";
import { Command } from "commander";
import type {
  Settings,
  SettingsService,
} from "../services/settings-service.js";
import {
  createMockPromptService,
  createMockTokenProvider,
} from "../services/test-helpers.js";
import {
  registerSettingsCommand,
  type SettingsCommandDependencies,
  settingsAction,
  settingsClearAction,
  settingsGetAction,
  settingsSetAction,
  settingsTermsAcceptAction,
  settingsTermsAction,
} from "./settings.js";

const SETTINGS: Settings = {
  user_id: "0198a7d0-6750-7ace-a68c-418062117d95",
  default_language_id: null,
  license_mode: "safe",
  blocked_license_ids: [],
  marketing_email_opted_out: false,
  example_generation_limit: 25,
  terms_required: true,
};

function createSettingsService(
  overrides: Partial<SettingsService> = {},
): SettingsService {
  return {
    getSettings: mock(() => Promise.resolve(SETTINGS)),
    updateSettings: mock(() => Promise.resolve(SETTINGS)),
    acceptTerms: mock(() =>
      Promise.resolve({ ...SETTINGS, terms_required: false }),
    ),
    ...overrides,
  };
}

function createDeps(
  overrides: Partial<SettingsCommandDependencies> = {},
): SettingsCommandDependencies {
  return {
    settingsService: createSettingsService(),
    tokenProvider: createMockTokenProvider(),
    promptService: createMockPromptService(),
    hasValidToken: true,
    mcpUrl: "https://mcp.githits.com",
    staticApiToken: false,
    stdinIsTTY: true,
    stdoutIsTTY: true,
    ...overrides,
  };
}

describe("settings commands", () => {
  it("prints the canonical object in overview JSON mode", async () => {
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsAction({ json: true }, createDeps());

    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(SETTINGS);
    output.mockRestore();
  });

  it("groups overview text into preferences, privacy, and account limits", async () => {
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsAction({}, createDeps());

    const text = String(output.mock.calls[0]?.[0]);
    expect(text).toContain("Preferences");
    expect(text).toContain("Privacy and terms");
    expect(text).toContain("Account limits");
    expect(text).toContain("Acceptance required");
    output.mockRestore();
  });

  it("PATCHes one typed setting without exposing its storage field", async () => {
    const updateSettings = mock(() => Promise.resolve(SETTINGS));
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsSetAction(
      "marketing-emails",
      ["enabled"],
      { json: true },
      createDeps({
        settingsService: createSettingsService({ updateSettings }),
      }),
    );

    expect(updateSettings).toHaveBeenCalledWith({
      marketing_email_opted_out: false,
    });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(SETTINGS);
    output.mockRestore();
  });

  it("gets one setting using its public value", async () => {
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsGetAction("marketing-emails", { json: true }, createDeps());

    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      key: "marketing-emails",
      value: "enabled",
    });
    output.mockRestore();
  });

  it("clears a list with an explicit empty-list PATCH", async () => {
    const updateSettings = mock(() => Promise.resolve(SETTINGS));
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsClearAction(
      "blocked-license-ids",
      {},
      createDeps({
        settingsService: createSettingsService({ updateSettings }),
      }),
    );

    expect(updateSettings).toHaveBeenCalledWith({ blocked_license_ids: [] });
    output.mockRestore();
  });

  it("registers key/value commands without per-setting flags", () => {
    const program = new Command();
    registerSettingsCommand(program);

    const settings = program.commands.find(
      (command) => command.name() === "settings",
    );
    expect(settings?.commands.map((command) => command.name())).toEqual([
      "show",
      "get",
      "set",
      "clear",
      "terms",
    ]);

    const setHelp = settings?.commands
      .find((command) => command.name() === "set")
      ?.helpInformation();
    expect(setHelp).toContain("set [options] <key> <values...>");
    expect(setHelp).not.toContain("--license-mode");
    expect(setHelp).not.toContain("--marketing-email-opted-out");
  });

  it.each([
    ["settings show --json", ["settings", "show", "--json"], SETTINGS],
    ["settings --json show", ["settings", "--json", "show"], SETTINGS],
    [
      "settings terms --json",
      ["settings", "terms", "--json"],
      { terms_required: true },
    ],
  ])("honors JSON mode for %s", async (_name, args, expected) => {
    const program = new Command();
    const output = spyOn(console, "log").mockImplementation(() => {});
    registerSettingsCommand(program, async () => createDeps());

    await program.parseAsync(["node", "githits", ...args]);

    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(expected);
    output.mockRestore();
  });

  it("guards every settings operation before account API access", async () => {
    const getSettings = mock(() => Promise.resolve(SETTINGS));
    const updateSettings = mock(() => Promise.resolve(SETTINGS));
    const acceptTerms = mock(() => Promise.resolve(SETTINGS));
    const deps = createDeps({
      hasValidToken: false,
      settingsService: createSettingsService({
        getSettings,
        updateSettings,
        acceptTerms,
      }),
    });

    const operations = [
      () => settingsAction({ json: true }, deps),
      () => settingsGetAction("license-mode", { json: true }, deps),
      () => settingsSetAction("license-mode", ["safe"], { json: true }, deps),
      () => settingsClearAction("blocked-license-ids", { json: true }, deps),
      () => settingsTermsAction({ json: true }, deps),
      () => settingsTermsAcceptAction({ yes: true, json: true }, deps),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toThrow(
        "No local GitHits authentication token found",
      );
    }
    expect(getSettings).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(acceptTerms).not.toHaveBeenCalled();
  });

  it("prints only stable terms fields in terms JSON mode", async () => {
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsTermsAction({ json: true }, createDeps());

    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      terms_required: true,
    });
    output.mockRestore();
  });

  it("confirms acceptance and force-refreshes an OAuth JWT", async () => {
    const acceptTerms = mock(() =>
      Promise.resolve({ ...SETTINGS, terms_required: false }),
    );
    const forceRefresh = mock(() => Promise.resolve("refreshed-jwt"));
    const confirm = mock(() => Promise.resolve(true));
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsTermsAcceptAction(
      { json: true },
      createDeps({
        settingsService: createSettingsService({ acceptTerms }),
        tokenProvider: createMockTokenProvider({ forceRefresh }),
        promptService: createMockPromptService({ confirm }),
      }),
    );

    expect(confirm).toHaveBeenCalled();
    expect(acceptTerms).toHaveBeenCalledTimes(1);
    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      accepted: true,
      token_refreshed: true,
      settings: { ...SETTINGS, terms_required: false },
    });
    output.mockRestore();
  });

  it("--yes skips confirmation", async () => {
    const confirm = mock(() => Promise.resolve(false));
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsTermsAcceptAction(
      { yes: true },
      createDeps({ promptService: createMockPromptService({ confirm }) }),
    );

    expect(confirm).not.toHaveBeenCalled();
    output.mockRestore();
  });

  it("never refreshes a static ghi-* API token", async () => {
    const forceRefresh = mock(() => Promise.resolve(undefined));
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsTermsAcceptAction(
      { yes: true, json: true },
      createDeps({
        staticApiToken: true,
        tokenProvider: createMockTokenProvider({ forceRefresh }),
      }),
    );

    expect(forceRefresh).not.toHaveBeenCalled();
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      accepted: true,
      token_refreshed: null,
    });
    output.mockRestore();
  });

  it("reports saved acceptance when OAuth refresh fails", async () => {
    const output = spyOn(console, "log").mockImplementation(() => {});

    await settingsTermsAcceptAction(
      { yes: true, json: true },
      createDeps({
        tokenProvider: createMockTokenProvider({
          forceRefresh: mock(() => Promise.reject(new Error("offline"))),
        }),
      }),
    );

    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      accepted: true,
      token_refreshed: false,
      warning:
        "Terms acceptance was saved, but authentication refresh failed. Run `githits login --force` before retrying other commands.",
    });
    output.mockRestore();
  });
});
