export {
  type AuthStatusDependencies,
  authStatusAction,
  registerAuthStatusCommand,
} from "./auth-status.js";
export {
  type FeedbackDependencies,
  type FeedbackOptions,
  feedbackAction,
  registerFeedbackCommand,
} from "./feedback.js";
export {
  type InitDependencies,
  type InitOptions,
  initAction,
  registerInitCommand,
} from "./init/index.js";
export {
  type LanguagesDependencies,
  type LanguagesOptions,
  languagesAction,
  registerLanguagesCommand,
} from "./languages.js";
export {
  type LoginDependencies,
  type LoginOptions,
  loginAction,
  registerLoginCommand,
} from "./login.js";
export {
  type LogoutDependencies,
  logoutAction,
  registerLogoutCommand,
} from "./logout.js";

export { createMcpServer, registerMcpCommand } from "./mcp.js";

export {
  registerSearchCommand,
  type SearchDependencies,
  type SearchOptions,
  searchAction,
} from "./search.js";
