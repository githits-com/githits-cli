import { Entry } from "@napi-rs/keyring";

/**
 * Service interface for system keychain operations.
 * Wraps @napi-rs/keyring Entry API for dependency injection and testability.
 */
export interface KeyringService {
  /** Get a password from the keychain. Returns null if not found. */
  getPassword(service: string, account: string): string | null;

  /** Set a password in the keychain. Throws KeychainUnavailableError on failure. */
  setPassword(service: string, account: string, password: string): void;

  /** Delete a password from the keychain. Returns false if not found. */
  deletePassword(service: string, account: string): boolean;
}

/**
 * Error thrown when the system keychain is not available or accessible.
 * Occurs when there is no keychain daemon, access is denied, or the
 * platform does not support keychain storage.
 */
export class KeychainUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "KeychainUnavailableError";
    this.cause = cause;
  }
}

/**
 * Wrap a keyring operation, converting platform errors into KeychainUnavailableError.
 * The @napi-rs/keyring binding throws plain Error objects with message strings
 * from the Rust keyring-rs crate. We classify these by string matching.
 */
function wrapKeyringError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new KeychainUnavailableError(
    `System keychain unavailable: ${message}`,
    error,
  );
}

/**
 * Production implementation using @napi-rs/keyring sync Entry class.
 * Creates a new Entry per operation (stateless, sub-millisecond local IPC).
 */
export class KeyringServiceImpl implements KeyringService {
  getPassword(service: string, account: string): string | null {
    try {
      return new Entry(service, account).getPassword();
    } catch (error) {
      wrapKeyringError(error);
    }
  }

  setPassword(service: string, account: string, password: string): void {
    try {
      new Entry(service, account).setPassword(password);
    } catch (error) {
      wrapKeyringError(error);
    }
  }

  deletePassword(service: string, account: string): boolean {
    try {
      return new Entry(service, account).deleteCredential();
    } catch (error) {
      wrapKeyringError(error);
    }
  }
}
