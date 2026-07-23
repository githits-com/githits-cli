import { type Command, InvalidArgumentError } from "commander";

const MIN_CALLBACK_PORT = 1;
const MAX_CALLBACK_PORT = 65_535;

export const CALLBACK_PORT_REQUIREMENT =
  "Port must be an integer between 1 and 65535.";

/** Options shared by commands that start the browser OAuth login flow. */
export interface OAuthCallbackOptions {
  /** Print the sign-in URL instead of opening a browser. */
  browser?: boolean;
  /** Port for the loopback OAuth callback server. */
  port?: number;
}

/**
 * Register browser OAuth options consistently on commands that use loginFlow.
 */
export function addOAuthCallbackOptions<T extends Command>(command: T): T {
  command
    .option(
      "--no-browser",
      "Print sign-in URL and callback forwarding instructions",
    )
    .option(
      "--port <port>",
      "Port for the local sign-in callback",
      parseOAuthCallbackPort,
    );
  return command;
}

/** Parse a CLI callback port without accepting partial numeric values. */
export function parseOAuthCallbackPort(raw: string): number {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new InvalidArgumentError(CALLBACK_PORT_REQUIREMENT);
  }

  const port = Number(normalized);
  if (!isValidOAuthCallbackPort(port)) {
    throw new InvalidArgumentError(CALLBACK_PORT_REQUIREMENT);
  }
  return port;
}

/** Validate callback ports supplied by programmatic loginFlow callers. */
export function isValidOAuthCallbackPort(port: number): boolean {
  return (
    Number.isInteger(port) &&
    port >= MIN_CALLBACK_PORT &&
    port <= MAX_CALLBACK_PORT
  );
}

/**
 * Explain how a browser on another computer can reach the loopback callback.
 */
export function formatRemoteCallbackInstructions(port: number): string {
  return [
    `The sign-in callback is listening on 127.0.0.1:${port} on this machine.`,
    "If the browser is on another computer, start an SSH tunnel from that computer:",
    `  ssh -N -L ${port}:127.0.0.1:${port} user@remote-host`,
    "Keep the tunnel open while signing in, and replace user@remote-host with your SSH destination.",
    "",
  ].join("\n");
}
