import { TERMS_URL, type TokenProvider } from "@githits/core-internal";
import { requireAuth } from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../container.js";
import type { PromptService } from "../services/prompt-service.js";
import { PromptServiceImpl } from "../services/prompt-service.js";
import { createCliFetch } from "../services/proxy-fetch.js";
import {
  getAccountsUrl,
  type Settings,
  type SettingsService,
  SettingsServiceImpl,
} from "../services/settings-service.js";
import {
  buildSettingsClearPatch,
  buildSettingsPatch,
  CLEARABLE_SETTINGS_KEYS,
  type ClearableSettingsKey,
  getSettingValue,
  parseClearableSettingsKey,
  parseSettingsKey,
  SETTINGS_KEYS,
  type SettingsKey,
  type SettingValue,
} from "./settings-schema.js";

const REFRESH_FAILURE_WARNING =
  "Terms acceptance was saved, but authentication refresh failed. Run `githits login --force` before retrying other commands.";

export interface SettingsOptions {
  json?: boolean;
}

export interface SettingsTermsAcceptOptions extends SettingsOptions {
  yes?: boolean;
}

export interface SettingsCommandDependencies {
  settingsService: SettingsService;
  tokenProvider: TokenProvider;
  promptService: PromptService;
  hasValidToken: boolean;
  mcpUrl: string;
  staticApiToken: boolean;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
}

export type SettingsDependenciesFactory =
  () => Promise<SettingsCommandDependencies>;

export async function settingsAction(
  options: SettingsOptions,
  deps: SettingsCommandDependencies,
): Promise<void> {
  requireAuth(deps);
  const settings = await deps.settingsService.getSettings();
  printSettings(settings, options.json ?? false);
}

export async function settingsSetAction(
  key: SettingsKey,
  values: string[],
  options: SettingsOptions,
  deps: SettingsCommandDependencies,
): Promise<void> {
  requireAuth(deps);
  const settings = await deps.settingsService.updateSettings(
    buildSettingsPatch(key, values),
  );
  printSettings(settings, options.json ?? false);
}

export async function settingsGetAction(
  key: SettingsKey,
  options: SettingsOptions,
  deps: SettingsCommandDependencies,
): Promise<void> {
  requireAuth(deps);
  const settings = await deps.settingsService.getSettings();
  printSetting(key, getSettingValue(settings, key), options.json ?? false);
}

export async function settingsClearAction(
  key: ClearableSettingsKey,
  options: SettingsOptions,
  deps: SettingsCommandDependencies,
): Promise<void> {
  requireAuth(deps);
  const settings = await deps.settingsService.updateSettings(
    buildSettingsClearPatch(key),
  );
  printSettings(settings, options.json ?? false);
}

export async function settingsTermsAction(
  options: SettingsOptions,
  deps: SettingsCommandDependencies,
): Promise<void> {
  requireAuth(deps);
  const settings = await deps.settingsService.getSettings();
  if (options.json) {
    console.log(JSON.stringify({ terms_required: settings.terms_required }));
    return;
  }
  console.log(formatTerms(settings));
}

export async function settingsTermsAcceptAction(
  options: SettingsTermsAcceptOptions,
  deps: SettingsCommandDependencies,
): Promise<void> {
  requireAuth(deps);
  if (!options.yes) {
    if (!deps.stdinIsTTY || !deps.stdoutIsTTY) {
      throw new Error(
        "Confirmation required. Review the Terms of Service, then run `githits settings terms accept --yes`.",
      );
    }
    const accepted = await deps.promptService.confirm(
      `Accept the GitHits Terms of Service at ${TERMS_URL}?`,
      false,
    );
    if (!accepted) {
      if (options.json) {
        console.log(JSON.stringify({ accepted: false }));
      } else {
        console.log("Terms were not accepted.");
      }
      return;
    }
  }

  const settings = await deps.settingsService.acceptTerms();
  let tokenRefreshed: boolean | null = null;
  let warning: string | undefined;
  if (!deps.staticApiToken) {
    try {
      tokenRefreshed = (await deps.tokenProvider.forceRefresh()) !== undefined;
    } catch {
      tokenRefreshed = false;
    }
    if (!tokenRefreshed) warning = REFRESH_FAILURE_WARNING;
  }

  if (options.json) {
    console.log(
      JSON.stringify({
        accepted: !settings.terms_required,
        token_refreshed: tokenRefreshed,
        settings,
        ...(warning ? { warning } : {}),
      }),
    );
    return;
  }

  console.log(
    settings.terms_required
      ? "The account still requires Terms of Service acceptance."
      : "Terms of Service accepted.",
  );
  if (warning) console.error(warning);
}

export function registerSettingsCommand(
  program: Command,
  dependenciesFactory: SettingsDependenciesFactory = createSettingsDependencies,
): void {
  const settings = program
    .command("settings")
    .summary("View and update account settings")
    .description(
      "View and update GitHits preferences, privacy, terms, and account limits.",
    )
    .option("--json", "Output the canonical settings object as JSON")
    .action(async (_options: SettingsOptions, command: Command) => {
      await settingsAction(
        settingsOptions(command),
        await dependenciesFactory(),
      );
    });

  settings
    .command("show")
    .summary("Show all account settings")
    .description("Show preferences, privacy, terms, and account limits.")
    .option("--json", "Output the canonical settings object as JSON")
    .action(async (_options: SettingsOptions, command: Command) => {
      await settingsAction(
        settingsOptions(command),
        await dependenciesFactory(),
      );
    });

  settings
    .command("get")
    .summary("Get one account setting")
    .description("Get one writable account setting by its public name.")
    .argument(
      "<key>",
      `Setting name: ${SETTINGS_KEYS.join(", ")}`,
      parseSettingsKey,
    )
    .option("--json", "Output the setting name and value as JSON")
    .action(
      async (key: SettingsKey, _options: SettingsOptions, command: Command) => {
        await settingsGetAction(
          key,
          settingsOptions(command),
          await dependenciesFactory(),
        );
      },
    );

  settings
    .command("set")
    .summary("Set one account setting")
    .description("Set one writable account setting using its public name.")
    .argument(
      "<key>",
      `Setting name: ${SETTINGS_KEYS.join(", ")}`,
      parseSettingsKey,
    )
    .argument("<values...>", "Typed setting value or list of values")
    .option("--json", "Output the canonical settings object as JSON")
    .addHelpText(
      "after",
      [
        "",
        "Values:",
        "  default-language-id <uuid>",
        "  license-mode <safe|yolo|custom>",
        "  blocked-license-ids <uuid> [uuid...]",
        "  marketing-emails <enabled|disabled>",
        "",
        "Use `githits settings clear <key>` for an empty or unset value.",
      ].join("\n"),
    )
    .action(
      async (
        key: SettingsKey,
        values: string[],
        _options: SettingsOptions,
        command: Command,
      ) => {
        await settingsSetAction(
          key,
          values,
          settingsOptions(command),
          await dependenciesFactory(),
        );
      },
    );

  settings
    .command("clear")
    .summary("Clear one account setting")
    .description(
      "Clear default-language-id or replace blocked-license-ids with an empty list.",
    )
    .argument(
      "<key>",
      `Setting name: ${CLEARABLE_SETTINGS_KEYS.join(", ")}`,
      parseClearableSettingsKey,
    )
    .option("--json", "Output the canonical settings object as JSON")
    .action(
      async (
        key: ClearableSettingsKey,
        _options: SettingsOptions,
        command: Command,
      ) => {
        await settingsClearAction(
          key,
          settingsOptions(command),
          await dependenciesFactory(),
        );
      },
    );

  const terms = settings
    .command("terms")
    .summary("Show Terms of Service status")
    .description("Show the current Terms of Service acceptance requirement.")
    .option("--json", "Output terms status as JSON")
    .action(async (_options: SettingsOptions, command: Command) => {
      await settingsTermsAction(
        settingsOptions(command),
        await dependenciesFactory(),
      );
    });

  terms
    .command("accept")
    .summary("Accept the current Terms of Service")
    .description(`Accept the current Terms of Service at ${TERMS_URL}.`)
    .option("--yes", "Accept without an interactive confirmation", false)
    .option("--json", "Output the acceptance result as JSON")
    .action(async (_options: SettingsTermsAcceptOptions, command: Command) => {
      await settingsTermsAcceptAction(
        settingsTermsAcceptOptions(command),
        await dependenciesFactory(),
      );
    });
}

function settingsOptions(command: Command): SettingsOptions {
  const options = command.optsWithGlobals<SettingsOptions>();
  return { json: options.json };
}

function settingsTermsAcceptOptions(
  command: Command,
): SettingsTermsAcceptOptions {
  const options = command.optsWithGlobals<SettingsTermsAcceptOptions>();
  return { json: options.json, yes: options.yes };
}

function printSettings(settings: Settings, json: boolean): void {
  console.log(json ? JSON.stringify(settings) : formatSettings(settings));
}

function printSetting(
  key: SettingsKey,
  value: SettingValue,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify({ key, value }));
    return;
  }
  if (Array.isArray(value)) {
    console.log(value.length > 0 ? value.join("\n") : "None");
    return;
  }
  console.log(value ?? "None");
}

function formatSettings(settings: Settings): string {
  return [
    "Preferences",
    `  Default language ID: ${settings.default_language_id ?? "Not set"}`,
    `  License mode: ${settings.license_mode}`,
    `  Blocked license IDs: ${formatList(settings.blocked_license_ids)}`,
    "",
    "Privacy and terms",
    `  Marketing emails: ${settings.marketing_email_opted_out ? "Disabled" : "Enabled"}`,
    `  Terms: ${settings.terms_required ? "Acceptance required" : "Accepted"}`,
    `  Terms URL: ${TERMS_URL}`,
    "",
    "Account limits",
    `  Example generation limit: ${settings.example_generation_limit ?? "Default"}`,
  ].join("\n");
}

function formatTerms(settings: Settings): string {
  return [
    "Terms of Service",
    `  Status: ${settings.terms_required ? "Acceptance required" : "Accepted"}`,
    `  URL: ${TERMS_URL}`,
  ].join("\n");
}

function formatList(values: string[] | null): string {
  return values?.length ? values.join(", ") : "None";
}

async function createSettingsDependencies(): Promise<SettingsCommandDependencies> {
  const container = await createContainer();
  return {
    settingsService: new SettingsServiceImpl(
      getAccountsUrl(),
      container.tokenProvider,
      createCliFetch(),
    ),
    tokenProvider: container.tokenProvider,
    promptService: new PromptServiceImpl(),
    hasValidToken: container.hasValidToken,
    mcpUrl: container.mcpUrl,
    staticApiToken: container.envApiToken !== undefined,
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
  };
}
