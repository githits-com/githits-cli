import {
  AuthenticationError,
  fetchWithTimeout,
  isFetchTimeoutError,
  LOCAL_AUTHENTICATION_MISSING_MESSAGE,
  SERVER_AUTHENTICATION_REJECTED_MESSAGE,
  type TokenProvider,
  validateServiceUrl,
} from "@githits/core-internal";
import { z } from "zod";

export const DEFAULT_ACCOUNTS_URL = "https://accounts.githits.com";

// Strip unknown fields so additive account API changes remain compatible with
// older CLI versions while every field this version consumes stays validated.
const SETTINGS_SCHEMA = z.object({
  user_id: z.uuid(),
  default_language_id: z.uuid().nullable(),
  license_mode: z.enum(["safe", "yolo", "custom"]),
  blocked_license_ids: z.array(z.uuid()).nullable(),
  marketing_email_opted_out: z.boolean(),
  example_generation_limit: z.number().int().nonnegative().nullable(),
  terms_required: z.boolean(),
});

export type Settings = z.infer<typeof SETTINGS_SCHEMA>;
export type LicenseMode = Settings["license_mode"];

export interface SettingsPatch {
  default_language_id?: string | null;
  license_mode?: LicenseMode;
  blocked_license_ids?: string[] | null;
  marketing_email_opted_out?: boolean;
}

export interface SettingsService {
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  acceptTerms(): Promise<Settings>;
}

/** CLI-only client for the self-scoped canonical account settings API. */
export class SettingsServiceImpl implements SettingsService {
  constructor(
    private readonly accountsUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async getSettings(): Promise<Settings> {
    return this.request("", "GET");
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    return this.request("", "PATCH", patch);
  }

  async acceptTerms(): Promise<Settings> {
    return this.request("/terms/accept", "POST", {});
  }

  private async request(
    suffix: string,
    method: "GET" | "PATCH" | "POST",
    body?: object,
  ): Promise<Settings> {
    const token = await this.tokenProvider.getToken();
    if (!token) {
      throw new AuthenticationError(
        LOCAL_AUTHENTICATION_MISSING_MESSAGE,
        "local",
      );
    }

    const accountsUrl = validateServiceUrl(
      this.accountsUrl,
      "GITHITS_ACCOUNTS_URL",
    ).replace(/\/+$/, "");
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${accountsUrl}/functions/v1/settings/me${suffix}`,
        {
          method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { fetchFn: this.fetchFn },
      );
    } catch (cause) {
      if (isFetchTimeoutError(cause)) {
        throw new Error("GitHits account settings request timed out.", {
          cause,
        });
      }
      throw new Error(
        "Could not reach GitHits account settings. Check your connection and GITHITS_ACCOUNTS_URL, then try again.",
        { cause },
      );
    }

    if (response.status === 401) {
      throw new AuthenticationError(
        SERVER_AUTHENTICATION_REJECTED_MESSAGE,
        "server",
      );
    }
    if (!response.ok) {
      throw new Error(await parseSettingsError(response));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new Error("GitHits returned an invalid settings response.", {
        cause,
      });
    }
    const parsed = SETTINGS_SCHEMA.safeParse(payload);
    if (!parsed.success) {
      throw new Error("GitHits returned an invalid settings response.", {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}

export function getAccountsUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return validateServiceUrl(
    env.GITHITS_ACCOUNTS_URL ?? DEFAULT_ACCOUNTS_URL,
    "GITHITS_ACCOUNTS_URL",
  );
}

async function parseSettingsError(response: Response): Promise<string> {
  const fallback = `Account settings request failed with status ${response.status}.`;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fallback;
  }
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const detail = record.error ?? record.message ?? record.reason;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}
