import open from "open";

/**
 * Service interface for browser operations.
 */
export interface BrowserService {
  /** Open URL in default browser */
  open(url: string): Promise<void>;
}

/**
 * Production implementation using the `open` package.
 */
export class BrowserServiceImpl implements BrowserService {
  async open(url: string): Promise<void> {
    await open(url);
  }
}
