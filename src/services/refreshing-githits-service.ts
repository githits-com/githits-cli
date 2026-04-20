import { executeWithTokenRefresh } from "./execute-with-token-refresh.js";
import {
  AuthenticationError,
  type FeedbackParams,
  type FeedbackResult,
  type GitHitsService,
  GitHitsServiceImpl,
  type Language,
  type SearchParams,
} from "./githits-service.js";
import type { TokenProvider } from "./token-manager.js";

/**
 * Factory function type for creating GitHitsService instances.
 * Injected for testability.
 */
export type ServiceFactory = (apiUrl: string, token: string) => GitHitsService;

/**
 * GitHitsService decorator that refreshes tokens before each call
 * and retries once on 401 (token may have expired between check and use).
 */
export class RefreshingGitHitsService implements GitHitsService {
  constructor(
    private readonly apiUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly serviceFactory: ServiceFactory = (url, token) =>
      new GitHitsServiceImpl(url, token),
  ) {}

  async search(params: SearchParams): Promise<string> {
    return this.withTokenRefresh((service) => service.search(params));
  }

  async getLanguages(): Promise<Language[]> {
    return this.withTokenRefresh((service) => service.getLanguages());
  }

  async submitFeedback(params: FeedbackParams): Promise<FeedbackResult> {
    return this.withTokenRefresh((service) => service.submitFeedback(params));
  }

  /**
   * Execute an operation with a fresh token.
   * On AuthenticationError, force-refresh and retry once.
   */
  private async withTokenRefresh<T>(
    operation: (service: GitHitsService) => Promise<T>,
  ): Promise<T> {
    return executeWithTokenRefresh({
      getToken: () => this.tokenProvider.getToken(),
      forceRefresh: () => this.tokenProvider.forceRefresh(),
      shouldRefresh: (error) => error instanceof AuthenticationError,
      executeWithToken: async (token) => {
        const service = this.serviceFactory(this.apiUrl, token);
        return operation(service);
      },
    });
  }
}
