export * from "@githits/core-internal";

export {
  getAppConfigDir,
  getAppConfigDirForEnv,
  getAuthConfigPath,
  getAuthConfigPathForEnv,
  getAuthFileStorageDir,
  getAuthFileStorageDirForEnv,
  getAuthLockDir,
  getLegacyAuthStorageDir,
  getLegacyAuthStorageDirForEnv,
  getLegacyMacAppConfigDir,
  getLegacyMacAppConfigDirForEnv,
  getLegacyMacAuthConfigPath,
  getLegacyMacAuthConfigPathForEnv,
  getLegacyMacAuthFileStorageDir,
  getLegacyMacAuthFileStorageDirForEnv,
} from "./app-config-paths.js";
export type { AuthConfig, AuthStorageMode } from "./auth-config.js";
export {
  AuthConfigError,
  loadAuthConfig,
  parseAuthStorageMode,
} from "./auth-config.js";
export type {
  AuthService,
  BuildAuthUrlParams,
  CallbackResult,
  ExchangeParams,
  OAuthMetadata,
  PkceParams,
  RefreshParams,
  RegisterClientParams,
  TokenResponse,
} from "./auth-service.js";
export { AuthServiceImpl } from "./auth-service.js";
export type {
  AuthSessionMetadata,
  AuthSessionMetadataStore,
} from "./auth-session-metadata-storage.js";
export { AuthSessionMetadataStorage } from "./auth-session-metadata-storage.js";
export type {
  AuthStorage,
  ClientRegistration,
  TokenData,
} from "./auth-storage.js";
export { AuthStorageImpl, normalizeBaseUrl } from "./auth-storage.js";
export type { BrowserService } from "./browser-service.js";
export { BrowserServiceImpl } from "./browser-service.js";
export {
  ChunkingKeyringService,
  WINDOWS_MAX_ENTRY_SIZE,
} from "./chunking-keyring-service.js";
export type { ExecResult, ExecService } from "./exec-service.js";
export { ExecServiceImpl } from "./exec-service.js";
export type { FileSystemService } from "./filesystem-service.js";
export { FileSystemServiceImpl } from "./filesystem-service.js";
export { KeychainAuthStorage } from "./keychain-auth-storage.js";
export type { KeyringService } from "./keyring-service.js";
export {
  KeychainUnavailableError,
  KeyringServiceImpl,
} from "./keyring-service.js";
export type { LockingAuthStorage } from "./locked-auth-storage.js";
export {
  AuthStorageLockTimeoutError,
  LockedAuthStorage,
} from "./locked-auth-storage.js";
export { MigratingAuthStorage } from "./migrating-auth-storage.js";
export {
  AuthStoragePolicyError,
  ModeAwareFileAuthStorage,
} from "./mode-aware-file-auth-storage.js";
export type {
  CheckboxChoice,
  ConfirmChoice,
  PromptService,
} from "./prompt-service.js";
export { PromptServiceImpl } from "./prompt-service.js";
export { refreshExpiredToken, TokenManager } from "./token-manager.js";
export type {
  RequiredUpdateNotice,
  UpdateCheckFetcher,
  UpdateCheckNotice,
  UpdateCheckService,
} from "./update-check-service.js";
export {
  formatRequiredUpdateNotice,
  formatUpdateCommand,
  formatUpdateNotice,
  NpmRegistryUpdateCheckService,
  resolveConfigHome,
  shouldRunRequiredUpdateEnforcement,
  shouldRunUpdateCheck,
} from "./update-check-service.js";
