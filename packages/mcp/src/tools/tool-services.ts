import type {
  CodeDiffService,
  CodeNavigationService,
  GitHitsService,
  GrepService,
  ListService,
  PackageIntelligenceService,
  ReadService,
  ResolveTargetService,
} from "@githits/core-internal";

/**
 * Services required to construct the MCP tool surface.
 *
 * Keep this seam narrower than the CLI container so remote MCP/server
 * integrations do not inherit local auth, filesystem, browser, or CLI state.
 */
export interface McpToolServices {
  githitsService: GitHitsService;
  codeNavigationService: CodeNavigationService & CodeDiffService;
  packageIntelligenceService: PackageIntelligenceService;
  listService: ListService;
  readService: ReadService;
  grepService: GrepService;
  resolveTargetService: ResolveTargetService;
}
