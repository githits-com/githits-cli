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
    const token = await this.tokenProvider.getToken();
    if (!token) {
      throw new AuthenticationError(
        "Authentication required. Run `githits login` to authenticate.",
      );
    }

    const service = this.serviceFactory(this.apiUrl, token);
    try {
      return await operation(service);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        const refreshedToken = await this.tokenProvider.forceRefresh();
        if (!refreshedToken) {
          throw error;
        }
        const refreshedService = this.serviceFactory(
          this.apiUrl,
          refreshedToken,
        );
        return operation(refreshedService);
      }
      throw error;
    }
  }
}
