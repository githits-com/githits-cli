import { createServer, type Server, type ServerResponse } from "node:http";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "@githits/core-internal";
import { z } from "zod";

/**
 * OAuth Authorization Server metadata from .well-known endpoint.
 */
export interface OAuthMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

/**
 * PKCE parameters generated for auth flow.
 */
export interface PkceParams {
  verifier: string;
  challenge: string;
  state: string;
}

/**
 * Parameters for building authorization URL.
 */
export interface BuildAuthUrlParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export type CallbackResult = CallbackSuccessResult | CallbackFailureResult;

/**
 * Successful OAuth callback with valid code and state.
 */
export interface CallbackSuccessResult {
  type: "success";
  code: string;
  state: string;
}

/**
 * OAuth callback failed before token exchange.
 */
export interface CallbackFailureResult {
  type: "oauth_error" | "invalid_callback" | "state_mismatch";
  message: string;
}

export interface CallbackEvaluationInput {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
  expectedState: string;
}

export interface CallbackEvaluationOutput {
  statusCode: number;
  html: string;
  result: CallbackResult;
}

/**
 * Parameters for exchanging authorization code for tokens.
 */
export interface ExchangeParams {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

/**
 * Parameters for refreshing an access token.
 */
export interface RefreshParams {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Token response from OAuth token endpoint.
 */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export type TerminalRefreshFailureReason =
  | "invalid_client"
  | "invalid_refresh_token";

export class TokenRefreshError extends Error {
  readonly status: number;
  readonly body: string;
  readonly oauthError: string | undefined;
  readonly oauthErrorDescription: string | undefined;

  constructor(status: number, body: string) {
    const details = parseOAuthErrorBody(body);
    const description =
      details.oauthErrorDescription ?? details.oauthError ?? body.trim();
    super(
      description
        ? `Token refresh failed: ${description}`
        : `Token refresh failed with HTTP ${status}`,
    );
    this.name = "TokenRefreshError";
    this.status = status;
    this.body = body;
    this.oauthError = details.oauthError;
    this.oauthErrorDescription = details.oauthErrorDescription;
  }
}

/**
 * Parameters for DCR registration.
 */
export interface RegisterClientParams {
  registrationEndpoint: string;
  redirectUri: string;
}

/**
 * Service interface for OAuth authentication operations.
 */
export interface AuthService {
  /** Discover OAuth endpoints from .well-known */
  discoverEndpoints(mcpBaseUrl: string): Promise<OAuthMetadata>;

  /** Register CLI as OAuth client via DCR */
  registerClient(
    params: RegisterClientParams,
  ): Promise<{ clientId: string; clientSecret: string }>;

  /** Generate PKCE parameters for auth flow */
  generatePkceParams(): PkceParams;

  /** Build authorization URL for browser redirect */
  buildAuthUrl(params: BuildAuthUrlParams): string;

  /** Start local callback server, resolves when callback received */
  startCallbackServer(
    port: number,
    expectedState: string,
  ): Promise<CallbackServerHandle>;

  /** Exchange authorization code for tokens */
  exchangeCodeForTokens(params: ExchangeParams): Promise<TokenResponse>;

  /** Refresh an expired access token */
  refreshAccessToken(params: RefreshParams): Promise<RefreshTokenResponse>;
}

export interface CallbackServerHandle {
  result: Promise<CallbackResult>;
  close(): Promise<void>;
}

/**
 * Production implementation of AuthService using OAuth PKCE with DCR.
 */
export class AuthServiceImpl implements AuthService {
  constructor(
    private readonly fetchFn?: typeof fetch,
    private readonly fetchTimeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  ) {}

  async discoverEndpoints(mcpBaseUrl: string): Promise<OAuthMetadata> {
    const url = `${mcpBaseUrl}/.well-known/oauth-authorization-server`;
    const response = await fetchWithTimeout(url, {}, this.fetchOptions());

    if (!response.ok) {
      throw new Error(
        `Failed to discover OAuth endpoints: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const authorizationEndpoint = data.authorization_endpoint;
    const tokenEndpoint = data.token_endpoint;
    const registrationEndpoint = data.registration_endpoint;

    if (!authorizationEndpoint || !tokenEndpoint || !registrationEndpoint) {
      throw new Error("OAuth metadata missing required endpoints");
    }

    return {
      authorizationEndpoint: authorizationEndpoint as string,
      tokenEndpoint: tokenEndpoint as string,
      registrationEndpoint: registrationEndpoint as string,
    };
  }

  async registerClient(
    params: RegisterClientParams,
  ): Promise<{ clientId: string; clientSecret: string }> {
    const response = await fetchWithTimeout(
      params.registrationEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "GitHits CLI",
          redirect_uris: [params.redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post",
        }),
      },
      this.fetchOptions(),
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Client registration failed: ${error}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (!data.client_id || !data.client_secret) {
      throw new Error("Client registration response missing required fields");
    }

    return {
      clientId: data.client_id as string,
      clientSecret: data.client_secret as string,
    };
  }

  generatePkceParams(): PkceParams {
    const verifier = generateCodeVerifier();
    return {
      verifier,
      challenge: generateCodeChallenge(verifier),
      state: generateState(),
    };
  }

  buildAuthUrl(params: BuildAuthUrlParams): string {
    const url = new URL(params.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("state", params.state);
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  startCallbackServer(
    port: number,
    expectedState: string,
  ): Promise<CallbackServerHandle> {
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const server = createServer();
    let callbackHandled = false;
    let resolved = false;

    const result = new Promise<CallbackResult>((resolve) => {
      server.on("request", (req, res) => {
        const address = server.address();
        const actualPort =
          typeof address === "object" && address !== null ? address.port : port;
        const url = new URL(req.url ?? "", `http://127.0.0.1:${actualPort}`);

        // Browsers frequently request favicon right after loading callback page.
        // Keep this endpoint quiet to avoid noisy follow-up errors.
        if (url.pathname === "/favicon.ico") {
          res.writeHead(204);
          res.end();
          return;
        }

        // Only handle /callback path
        if (url.pathname !== "/callback") {
          if (callbackHandled) {
            sendHtmlResponse(
              res,
              200,
              successHtml("You're already signed in."),
            );
            return;
          }
          sendHtmlResponse(
            res,
            404,
            errorHtml(
              "Invalid callback path.",
              "Run `githits login` to start authentication.",
            ),
          );
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");
        const evaluation = evaluateCallback({
          code,
          state,
          error,
          errorDescription,
          expectedState,
        });
        callbackHandled = true;
        sendHtmlResponse(res, evaluation.statusCode, evaluation.html);
        if (!resolved) {
          resolved = true;
          resolve(evaluation.result);
        }
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => closeServer(server), 1500);
      });
    });

    return new Promise<CallbackServerHandle>((resolve, reject) => {
      const onError = (err: Error) => {
        reject(new Error(`Failed to start callback server: ${err.message}`));
      };
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        server.on("error", () => {});
        resolve({
          result,
          close: async () => {
            if (closeTimer) clearTimeout(closeTimer);
            await closeServer(server);
          },
        });
      });
    });
  }

  async exchangeCodeForTokens(params: ExchangeParams): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    });

    const response = await fetchWithTimeout(
      params.tokenEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      this.fetchOptions(),
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return parseTokenResponse(await response.json());
  }

  async refreshAccessToken(
    params: RefreshParams,
  ): Promise<RefreshTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
    });

    const response = await fetchWithTimeout(
      params.tokenEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      this.fetchOptions(),
    );

    if (!response.ok) {
      const error = await response.text();
      throw new TokenRefreshError(response.status, error);
    }

    return parseRefreshTokenResponse(await response.json());
  }

  private fetchOptions(): {
    fetchFn?: typeof fetch;
    timeoutMs: number;
  } {
    return {
      fetchFn: this.fetchFn,
      timeoutMs: this.fetchTimeoutMs,
    };
  }
}

export function classifyTerminalRefreshError(
  error: unknown,
): TerminalRefreshFailureReason | undefined {
  if (!(error instanceof TokenRefreshError)) return undefined;

  const oauthError = error.oauthError?.toLowerCase();
  const text = [
    error.oauthError,
    error.oauthErrorDescription,
    error.body,
    error.message,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();

  if (
    oauthError === "invalid_client" ||
    text.includes("client not found") ||
    text.includes("client id not found") ||
    text.includes("client_id not found") ||
    text.includes("oauth client not found") ||
    text.includes("client does not match") ||
    text.includes("client authentication required") ||
    text.includes("invalid client credentials")
  ) {
    return "invalid_client";
  }

  // RFC 6749 §5.2: for the refresh_token grant, `invalid_grant` means the
  // refresh token is expired, revoked, or otherwise no longer valid. Trust the
  // structured code on its own; the substring checks below are a fallback for
  // servers that report the same condition without a clean error code.
  if (oauthError === "invalid_grant") {
    return "invalid_refresh_token";
  }

  if (
    text.includes("invalid refresh token") ||
    text.includes("refresh token already used") ||
    text.includes("already used") ||
    text.includes("session expired") ||
    text.includes("session not found")
  ) {
    return "invalid_refresh_token";
  }

  return undefined;
}

function parseOAuthErrorBody(body: string): {
  oauthError: string | undefined;
  oauthErrorDescription: string | undefined;
} {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      oauthError: stringField(parsed.error),
      oauthErrorDescription:
        stringField(parsed.error_description) ??
        stringField(parsed.errorDescription) ??
        stringField(parsed.message) ??
        stringField(parsed.msg),
    };
  } catch {
    return {
      oauthError: undefined,
      oauthErrorDescription: undefined,
    };
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Default token lifetime (seconds) applied when the OAuth server omits
 * `expires_in` or returns a value that is not a finite positive number.
 */
const DEFAULT_TOKEN_EXPIRES_IN_SECONDS = 3600;

const nonEmptyString = z.string().min(1);

/**
 * Coerces `expires_in` to a usable lifetime. OAuth servers should send a JSON
 * number per RFC 6749, but some emit numeric strings, and a missing, zero,
 * negative, or non-numeric value would otherwise corrupt the computed expiry
 * (e.g. `new Date(Date.now() + NaN)` throws). Any non-positive or non-finite
 * value falls back to the default lifetime.
 */
const expiresInSchema = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    const numeric = typeof value === "string" ? Number(value) : value;
    return typeof numeric === "number" &&
      Number.isFinite(numeric) &&
      numeric > 0
      ? numeric
      : DEFAULT_TOKEN_EXPIRES_IN_SECONDS;
  });

const TokenResponseSchema = z.object({
  access_token: nonEmptyString,
  refresh_token: nonEmptyString,
  expires_in: expiresInSchema,
});

const RefreshTokenResponseSchema = z.object({
  access_token: nonEmptyString,
  refresh_token: nonEmptyString.optional(),
  expires_in: expiresInSchema,
});

function parseTokenResponse(data: unknown): TokenResponse {
  const parsed = TokenResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Token response missing required fields");
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresIn: parsed.data.expires_in,
  };
}

function parseRefreshTokenResponse(data: unknown): RefreshTokenResponse {
  const parsed = RefreshTokenResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Token response missing required fields");
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresIn: parsed.data.expires_in,
  };
}

function successHtml(title = "You're signed in"): string {
  return `<!DOCTYPE html>
<html><head>
<title>GitHits CLI</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Lexend:wght@600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    width: 100%;
    padding: 16px;
    background: #21262d;
    color: #ffffff;
    font-family: 'Inter', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 0 16px;
  }
  .message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .success-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid #57fec9;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .heading {
    font-family: 'Lexend', sans-serif;
    font-weight: 600;
    font-size: 32px;
    line-height: 40px;
    color: #ffffff;
    margin: 0;
    text-align: center;
    text-wrap: pretty;
  }
  .text {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 16px;
    line-height: 24px;
    margin: 0;
    text-align: center;
    text-wrap: pretty;
  }
  .text-muted {
    color: #abb2bf;
  }${COPY_BTN_CSS}
</style>
</head>
<body>
  <div class="content">
    <div class="success-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#57fec9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
    <div class="message">
      <h1 class="heading">${escapeHtml(title)}</h1>
      <p class="text text-muted">You can close this window and return to your terminal.</p>
    </div>

    <svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 554 129.3" width="103" height="24" role="img" aria-label="GitHits">
      <title>GitHits</title>
      <defs>
        <linearGradient id="wm-grad" x1="234.9" y1="64.7" x2="555.5" y2="64.7" gradientUnits="userSpaceOnUse">
          <stop offset="0" style="stop-color: #ff4fae" />
          <stop offset="1" style="stop-color: #ff872f" />
        </linearGradient>
      </defs>
      <path d="M148.6,29.1c7.9,0,14.4-6.4,14.4-14.4S156.6.3,148.6.3s-14.4,6.4-14.4,14.4,6.4,14.4,14.4,14.4Z" fill="#ff4fae" />
      <path d="M383.9,29.1c7.9,0,14.4-6.4,14.4-14.4s-6.4-14.4-14.4-14.4-14.4,6.4-14.4,14.4,6.4,14.4,14.4,14.4ZM396.4,40.8h-25v86.6h25V40.8ZM454.3,8.5h-25v32.3h-18.8v24h18.8v62.6h25v-62.6h18.8v-24h-18.8V8.5ZM553.1,92.2c-.9-2.6-2.2-4.9-4.1-6.9-2.2-2.4-5.1-4.4-8.8-6.2-3.7-1.8-8.2-3.4-13.4-4.9-4.1-1.1-7.3-2.1-9.6-3-2.4-.9-4.1-1.7-5.3-2.4-1.1-.8-1.9-1.7-2.5-2.9-.6-1.1-.9-2.3-.9-3.5s.2-2.4.7-3.4,1.2-1.9,2.2-2.6c1-.7,2.2-1.3,3.7-1.6s3.2-.5,5-.5,4.5.4,7.1,1.3c2.6.9,5.2,2.1,7.7,3.7,2.5,1.6,4.7,3.3,6.7,5.2l12.5-14.2c-2.8-2.8-6-5.2-9.6-7.3-3.7-2.1-7.7-3.7-11.9-4.8-4.3-1.1-8.7-1.7-13.2-1.7s-8.8.7-12.9,1.9c-4.1,1.3-7.7,3.1-10.8,5.5s-5.6,5.2-7.3,8.5c-1.8,3.3-2.6,7-2.6,11s.5,6.4,1.6,9.2c1,2.8,2.5,5.3,4.5,7.7,2.3,2.5,5.4,4.7,9.3,6.7s8.6,3.7,14.2,5.1c3.6,1,6.6,1.9,8.9,2.8,2.3.8,4,1.6,5.1,2.3,2,1.4,3,3.3,3,5.7s-.2,2.4-.7,3.5-1.2,2-2.2,2.7-2.2,1.3-3.5,1.7c-1.4.4-2.9.6-4.5.6-4.2,0-8.4-.8-12.5-2.5-4.2-1.6-7.9-4.3-11.2-8l-14.7,12.8c3.8,4.8,8.9,8.6,15.2,11.4,6.3,2.8,13.5,4.1,21.7,4.1s12.5-1.2,17.8-3.7,9.4-5.8,12.4-10.1c3-4.3,4.5-9.2,4.5-14.7s-.4-6-1.3-8.6h-.3ZM327.2,60.5h-50.2V6h-25v121.4h25v-42.8h50.2v42.8h25V6h-25v54.5Z" fill="url(#wm-grad)" />
      <path d="M239.1,64.8v-24h-18.8V8.5h-25v32.3h-18.8v24h18.8v62.6h25v-62.6h18.8ZM161.1,40.8h-25v86.6h25V40.8ZM91.6,84.6h-26.8v-24h54s1.2,4.3,1.1,12.1c-.3,30.6-25.3,55.5-55.9,55.7h-.5C27.4,128.4-1.6,98.3,0,61.8,1.5,29.6,27.4,3.4,59.6,1.4c21-1.2,40,7.7,52.4,22.4l-17.2,17.2c-7.7-10.1-20.3-16.4-34.3-15.4-19.4,1.4-35,17.1-36.4,36.5-1.6,23,16.6,42.2,39.3,42.2s28-19.7,28-19.7h.2Z" fill="#ff4fae" />
    </svg>

    ${HELP_CTA}
  </div>
  ${COPY_SCRIPT_HTML}
</body></html>`;
}

const KNOWN_OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Access was denied.",
};

function describeOauthError(code: string, description: string | null): string {
  const mapped = KNOWN_OAUTH_ERROR_MESSAGES[code];
  if (mapped) return mapped;
  if (description) {
    return /[.!?]$/.test(description) ? description : `${description}.`;
  }
  return "Something went wrong while signing in.";
}

export function evaluateCallback(
  input: CallbackEvaluationInput,
): CallbackEvaluationOutput {
  if (input.error) {
    const message = input.errorDescription
      ? `${input.error}: ${input.errorDescription}`
      : input.error;
    const browserMessage = describeOauthError(
      input.error,
      input.errorDescription,
    );
    return {
      statusCode: 200,
      html: errorHtml(browserMessage, input.error, RETRY_CTA),
      result: { type: "oauth_error", message },
    };
  }

  if (input.code && input.state) {
    if (input.state !== input.expectedState) {
      return {
        statusCode: 400,
        html: errorHtml(
          "Sign-in could not be verified for security reasons.",
          undefined,
          RETRY_CTA,
        ),
        result: {
          type: "state_mismatch",
          message: "Security validation failed (state mismatch)",
        },
      };
    }

    return {
      statusCode: 200,
      html: successHtml(),
      result: { type: "success", code: input.code, state: input.state },
    };
  }

  return {
    statusCode: 400,
    html: errorHtml(
      "Sign-in did not complete correctly.",
      undefined,
      RETRY_CTA,
    ),
    result: {
      type: "invalid_callback",
      message: "Authentication callback missing required parameters",
    },
  };
}

function errorHtml(
  error: string,
  errorCode?: string,
  ctaHtml?: string,
): string {
  const errorCodeHtml = errorCode
    ? `<p class="error-code">Error code: <code>${escapeHtml(errorCode)}</code></p>`
    : "";
  return `<!DOCTYPE html>
<html><head>
<title>GitHits CLI</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Lexend:wght@600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    width: 100%;
    padding: 16px;
    background: #21262d;
    color: #ffffff;
    font-family: 'Inter', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 0 16px;
  }
  .message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .error-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid #ff5a6a;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .heading {
    font-family: 'Lexend', sans-serif;
    font-weight: 600;
    font-size: 32px;
    line-height: 40px;
    color: #ffffff;
    margin: 0;
    text-align: center;
    text-wrap: pretty;
  }
  .text {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 16px;
    line-height: 24px;
    margin: 0;
    text-align: center;
    text-wrap: pretty;
  }
  .text-muted {
    color: #abb2bf;
  }
  .footer-text {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 12px;
    line-height: 16px;
    color: #abb2bf;
    margin: 0;
    text-align: center;
    text-wrap: pretty;
  }
  .footer-link {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .error-code {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 12px;
    line-height: 16px;
    color: #abb2bf;
    opacity: 0.7;
    margin: 4px 0 0;
    text-align: center;
  }
  .error-code code {
    font-size: 11px;
    padding: 0 5px;
  }
  code {
    font-family: 'Consolas', monospace;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.08);
    padding: 1px 6px;
    border-radius: 4px;
    color: #ffffff;
  }${COPY_BTN_CSS}
</style>
</head>
<body>
  <div class="content">
    <div class="error-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ff5a6a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </div>

    <div class="message">
      <h1 class="heading">Sign-in failed</h1>
      <p class="text text-muted">${escapeHtml(error)}</p>
      ${errorCodeHtml}
    </div>

    ${ctaHtml ?? ""}

    <svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 554 129.3" width="103" height="24" role="img" aria-label="GitHits">
      <title>GitHits</title>
      <defs>
        <linearGradient id="wm-grad" x1="234.9" y1="64.7" x2="555.5" y2="64.7" gradientUnits="userSpaceOnUse">
          <stop offset="0" style="stop-color: #ff4fae" />
          <stop offset="1" style="stop-color: #ff872f" />
        </linearGradient>
      </defs>
      <path d="M148.6,29.1c7.9,0,14.4-6.4,14.4-14.4S156.6.3,148.6.3s-14.4,6.4-14.4,14.4,6.4,14.4,14.4,14.4Z" fill="#ff4fae" />
      <path d="M383.9,29.1c7.9,0,14.4-6.4,14.4-14.4s-6.4-14.4-14.4-14.4-14.4,6.4-14.4,14.4,6.4,14.4,14.4,14.4ZM396.4,40.8h-25v86.6h25V40.8ZM454.3,8.5h-25v32.3h-18.8v24h18.8v62.6h25v-62.6h18.8v-24h-18.8V8.5ZM553.1,92.2c-.9-2.6-2.2-4.9-4.1-6.9-2.2-2.4-5.1-4.4-8.8-6.2-3.7-1.8-8.2-3.4-13.4-4.9-4.1-1.1-7.3-2.1-9.6-3-2.4-.9-4.1-1.7-5.3-2.4-1.1-.8-1.9-1.7-2.5-2.9-.6-1.1-.9-2.3-.9-3.5s.2-2.4.7-3.4,1.2-1.9,2.2-2.6c1-.7,2.2-1.3,3.7-1.6s3.2-.5,5-.5,4.5.4,7.1,1.3c2.6.9,5.2,2.1,7.7,3.7,2.5,1.6,4.7,3.3,6.7,5.2l12.5-14.2c-2.8-2.8-6-5.2-9.6-7.3-3.7-2.1-7.7-3.7-11.9-4.8-4.3-1.1-8.7-1.7-13.2-1.7s-8.8.7-12.9,1.9c-4.1,1.3-7.7,3.1-10.8,5.5s-5.6,5.2-7.3,8.5c-1.8,3.3-2.6,7-2.6,11s.5,6.4,1.6,9.2c1,2.8,2.5,5.3,4.5,7.7,2.3,2.5,5.4,4.7,9.3,6.7s8.6,3.7,14.2,5.1c3.6,1,6.6,1.9,8.9,2.8,2.3.8,4,1.6,5.1,2.3,2,1.4,3,3.3,3,5.7s-.2,2.4-.7,3.5-1.2,2-2.2,2.7-2.2,1.3-3.5,1.7c-1.4.4-2.9.6-4.5.6-4.2,0-8.4-.8-12.5-2.5-4.2-1.6-7.9-4.3-11.2-8l-14.7,12.8c3.8,4.8,8.9,8.6,15.2,11.4,6.3,2.8,13.5,4.1,21.7,4.1s12.5-1.2,17.8-3.7,9.4-5.8,12.4-10.1c3-4.3,4.5-9.2,4.5-14.7s-.4-6-1.3-8.6h-.3ZM327.2,60.5h-50.2V6h-25v121.4h25v-42.8h50.2v42.8h25V6h-25v54.5Z" fill="url(#wm-grad)" />
      <path d="M239.1,64.8v-24h-18.8V8.5h-25v32.3h-18.8v24h18.8v62.6h25v-62.6h18.8ZM161.1,40.8h-25v86.6h25V40.8ZM91.6,84.6h-26.8v-24h54s1.2,4.3,1.1,12.1c-.3,30.6-25.3,55.5-55.9,55.7h-.5C27.4,128.4-1.6,98.3,0,61.8,1.5,29.6,27.4,3.4,59.6,1.4c21-1.2,40,7.7,52.4,22.4l-17.2,17.2c-7.7-10.1-20.3-16.4-34.3-15.4-19.4,1.4-35,17.1-36.4,36.5-1.6,23,16.6,42.2,39.3,42.2s28-19.7,28-19.7h.2Z" fill="#ff4fae" />
    </svg>

    <p class="footer-text">Having trouble? Check our <a class="footer-link" href="https://app.githits.com/docs/" target="_blank" rel="noopener noreferrer">documentation</a> or contact <a class="footer-link" href="mailto:support@githits.com">support</a>.</p>
  </div>
  ${COPY_SCRIPT_HTML}
</body></html>`;
}

function sendHtmlResponse(
  res: ServerResponse,
  statusCode: number,
  html: string,
): void {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** Close server gracefully */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const COPY_ICON_SVG = `<svg class="githits-cli-icon githits-cli-icon-copy" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

const CHECK_ICON_SVG = `<svg class="githits-cli-icon githits-cli-icon-check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

function commandButton(cmd: string): string {
  const escaped = escapeHtml(cmd);
  return `<button type="button" class="githits-cli-btn" data-copy="${escaped}" aria-label="Copy command: ${escaped}"><span class="githits-cli-cmd">${escaped}</span>${COPY_ICON_SVG}${CHECK_ICON_SVG}</button>`;
}

function ctaBlock(introHtml: string, commands: string[]): string {
  const buttons = commands.map(commandButton).join("\n      ");
  return `<div class="cli-cta">
      <p class="tip">${introHtml}</p>
      ${buttons}
    </div>`;
}

const COPY_BTN_CSS = `
  .wordmark {
    margin: 16px 0;
  }
  .cli-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin: 16px 0 0;
  }
  .wordmark + .cli-cta {
    margin-top: 0;
  }
  .tip {
    font-family: 'Inter', sans-serif;
    font-weight: 400;
    font-size: 14px;
    line-height: 20px;
    color: #d5d9df;
    margin: 0;
    text-align: center;
    text-wrap: pretty;
  }
  .githits-cli-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background-color: rgba(255, 255, 255, 0.08);
    border: none;
    border-radius: 0.5rem;
    padding: 1rem 1.25rem;
    font-family: Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 14px;
    font-weight: 500;
    color: #abb2bf;
    cursor: pointer;
    line-height: 1;
    transition: background-color 0.2s ease, transform 0.1s ease, color 0.2s ease;
  }
  .githits-cli-btn:hover {
    color: #d5d9df;
  }
  .githits-cli-btn:active {
    transform: scale(0.98);
  }
  .githits-cli-btn:focus-visible {
    outline: 2px solid #abb2bf;
    outline-offset: 2px;
  }
  .githits-cli-cmd {
    white-space: nowrap;
  }
  .githits-cli-icon {
    width: 14px;
    height: 14px;
    color: #abb2bf;
    flex-shrink: 0;
  }
  .githits-cli-btn.copied .githits-cli-icon-copy { display: none; }
  .githits-cli-btn:not(.copied) .githits-cli-icon-check { display: none; }
  .githits-cli-btn.copied .githits-cli-icon { color: #abb2bf; }`;

const COPY_SCRIPT_HTML = `<script>
(function() {
  var timers = new WeakMap();
  var buttons = document.querySelectorAll('.githits-cli-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function(e) {
      var target = e.currentTarget;
      var text = target.getAttribute('data-copy');
      if (!text || !navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function() {
        target.classList.add('copied');
        var existing = timers.get(target);
        if (existing) clearTimeout(existing);
        timers.set(target, setTimeout(function() {
          target.classList.remove('copied');
          timers.delete(target);
        }, 1500));
      });
    });
  }
})();
</script>`;

const RETRY_CTA = ctaBlock(
  "To try again, run these commands in your terminal:",
  ["npx githits@latest logout", "npx githits@latest login"],
);

const HELP_CTA = ctaBlock("Explore available commands with:", [
  "npx githits@latest --help",
]);

/** Escape HTML to prevent XSS */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
