import type { CodeNavigationService } from "../services/code-navigation-service.js";
import type { GitHitsService } from "../services/githits-service.js";
import type { PackageIntelligenceService } from "../services/package-intelligence-service.js";

/**
 * Services required to construct the MCP tool surface.
 *
 * Keep this seam narrower than the CLI container so remote MCP/server
 * integrations do not inherit local auth, filesystem, browser, or CLI state.
 */
export interface McpToolServices {
  githitsService: GitHitsService;
  codeNavigationService: CodeNavigationService;
  packageIntelligenceService: PackageIntelligenceService;
}
