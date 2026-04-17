export {
  type AgentDefinition,
  agentDefinitions,
  buildCheckboxChoices,
  type CliCommand,
  type CliSetup,
  type ConfigFileSetup,
  detectAgents,
  type SetupConfig,
} from "./agent-definitions.js";
export {
  type InitDependencies,
  type InitOptions,
  initAction,
  registerInitCommand,
} from "./init.js";
export {
  executeCliSetup,
  executeConfigFileSetup,
  formatSetupPreview,
  type MergeResult,
  mergeServerConfig,
  type SetupResult,
} from "./setup-handlers.js";
