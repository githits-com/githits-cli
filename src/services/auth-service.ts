import { createServer, type Server, type ServerResponse } from "node:http";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "../auth/pkce.js";

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
  ): Promise<CallbackResult>;

  /** Exchange authorization code for tokens */
  exchangeCodeForTokens(params: ExchangeParams): Promise<TokenResponse>;

  /** Refresh an expired access token */
  refreshAccessToken(params: RefreshParams): Promise<RefreshTokenResponse>;
}

/**
 * Production implementation of AuthService using OAuth PKCE with DCR.
 */
export class AuthServiceImpl implements AuthService {
  async discoverEndpoints(mcpBaseUrl: string): Promise<OAuthMetadata> {
    const url = `${mcpBaseUrl}/.well-known/oauth-authorization-server`;
    const response = await fetch(url);

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
    const response = await fetch(params.registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "GitHits CLI",
        redirect_uris: [params.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });

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
  ): Promise<CallbackResult> {
    return new Promise((resolve, reject) => {
      let callbackHandled = false;
      let resolved = false;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "", `http://127.0.0.1:${port}`);

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
              successHtml("Authentication already completed."),
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

      // Bind to 127.0.0.1 only for security
      server.listen(port, "127.0.0.1");
      server.on("error", (err) => {
        reject(new Error(`Failed to start callback server: ${err.message}`));
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

    const response = await fetch(params.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

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

    const response = await fetch(params.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    return parseRefreshTokenResponse(await response.json());
  }
}

function parseTokenResponse(data: unknown): TokenResponse {
  const d = data as Record<string, unknown>;
  if (!d.access_token || !d.refresh_token) {
    throw new Error("Token response missing required fields");
  }
  return {
    accessToken: d.access_token as string,
    refreshToken: d.refresh_token as string,
    expiresIn: (d.expires_in as number) || 3600,
  };
}

function parseRefreshTokenResponse(data: unknown): RefreshTokenResponse {
  const d = data as Record<string, unknown>;
  if (!d.access_token) {
    throw new Error("Token response missing required fields");
  }
  return {
    accessToken: d.access_token as string,
    refreshToken:
      typeof d.refresh_token === "string" ? d.refresh_token : undefined,
    expiresIn: (d.expires_in as number) || 3600,
  };
}

function successHtml(title = "Authentication successful"): string {
  return `<!DOCTYPE html>
<html><head><title>GitHits CLI</title>
<style>
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    margin: 0;
    background: radial-gradient(circle at center center, #4d3648, #3a2835, #261a22, #0d1117);
  }
  .card {
    text-align: center;
    background: rgba(13, 17, 23, 0.75);
    padding: 3rem;
    border-radius: 16px;
    border: 1px solid rgba(244, 11, 166, 0.35);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    max-width: 720px;
  }
  h1 {
    color: #f40ba6;
    margin-bottom: 0.75rem;
    font-size: 3rem;
    font-weight: 700;
  }
  p {
    color: #f385a5;
    font-size: 1.1rem;
    margin: 0;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body></html>`;
}

export function evaluateCallback(
  input: CallbackEvaluationInput,
): CallbackEvaluationOutput {
  if (input.error) {
    const message = input.errorDescription
      ? `${input.error}: ${input.errorDescription}`
      : input.error;
    return {
      statusCode: 200,
      html: errorHtml(message, "Run `githits login` to try again."),
      result: { type: "oauth_error", message },
    };
  }

  if (input.code && input.state) {
    if (input.state !== input.expectedState) {
      return {
        statusCode: 400,
        html: errorHtml(
          "Authentication failed security validation (state mismatch)",
          "Run `githits login` to try again.",
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
      "Authentication callback was missing required parameters",
      "Run `githits login` to try again.",
    ),
    result: {
      type: "invalid_callback",
      message: "Authentication callback missing required parameters",
    },
  };
}

function errorHtml(error: string, nextStep?: string): string {
  const nextStepHtml = nextStep ? `<p>${escapeHtml(nextStep)}</p>` : "";
  return `<!DOCTYPE html>
<html><head><title>GitHits CLI</title>
<style>
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    margin: 0;
    background: radial-gradient(circle at center center, #4d3648, #3a2835, #261a22, #0d1117);
  }
  .card {
    text-align: center;
    background: rgba(13, 17, 23, 0.75);
    padding: 3rem;
    border-radius: 16px;
    border: 1px solid rgba(239, 68, 68, 0.35);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    max-width: 720px;
  }
  h1 {
    color: #ef4444;
    margin-bottom: 0.75rem;
    font-size: 3rem;
    font-weight: 700;
  }
  p {
    color: #f385a5;
    font-size: 1.1rem;
    margin: 0;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Authentication failed</h1>
    <p>${escapeHtml(error)}</p>
    ${nextStepHtml}
  </div>
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
function closeServer(server: Server): void {
  server.close();
}

/** Escape HTML to prevent XSS */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
