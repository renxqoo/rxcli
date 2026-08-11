/**
 * @renxqoo/agent-data-cli —— agent-native CLI SDK 入口
 *
 * 本包提供业务包构建 agent 友好 CLI 所需的全部基础服务:
 *   - 请求方法(get/post/...,带鉴权 + 401 自动续期)直接挂 ctx,无 client 层
 *   - 统一输出格式:成功/失败的统一输出契约(stdout=数据 / stderr=一切)
 *   - 错误分类:9 类类型化错误 + exit code 映射
 *   - 凭证:provider chain + OAuth device flow,供开发者写 auth Plugin 用(阶段 2)
 *   - 管道:unix 管道支持(stdin 读上游记录 / stdout 吐统一输出格式)
 *   - skill:list/read/sync + 命令文档自动生成(阶段 3)
 *
 * 详细设计见 ./docs/ 目录(随包发布)。
 *
 * 用法(业务包入口):
 * ```ts
 * import { defineCli, defineCommand, defineCommands, errs } from '@renxqoo/agent-data-cli'
 * ```
 */

// 核心装配
export { defineCli, defineCommand, defineCommandFromArgs, defineCommands } from "./define.js";

// 认证基础能力(defineAuth 覆盖标准场景；特殊协议可用这些公开边界组合 Plugin)
export {
  OAuthClient,
  type OAuthFetch,
  injectAuthHeader,
  type AuthStyle,
  // OAuth device flow(供 auth 命令 / OAuth provider 用)
  deviceAuthorization,
  pollDeviceToken,
  refreshAccessToken,
  getUserInfo,
  revokeToken,
  registerClient,
  createOn401Hook,
  generateCodeVerifier,
  computeCodeChallenge,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  clientCredentialsToken,
  type DeviceAuthInfo,
  type TokenInfo,
  type UserInfo,
  type OAuthClientConfig,
  type PollResult,
  type ClientMetadata,
  type RegisteredClient,
  fetchScopesFromMetadata,
} from "./oauth.js";

// 多流程鉴权(L3 策略层 + L2 基础设施)
export { type AuthFlow, type FlowType, type FlowDeps } from "./flows/types.js";
export { defaultBrowserOpener, type BrowserOpener } from "./infra/browser.js";
export {
  waitForCallback,
  evaluateCallbackRequest,
  type CallbackResult,
  type CallbackHandle,
} from "./infra/callback-server.js";

// 凭证基础能力(供开发者写 auth Plugin 用:provider chain + store)
export {
  fileStore,
  memoryStore,
  defaultProviders,
  flagProvider,
  envProvider,
  envBearerProvider,
  fileProvider,
  oauthProvider,
  resolveWithChain,
  resolveIdentityWithChain,
  type ConfigStore,
  type CredentialProvider,
  type ProviderContext,
  type TokenResult,
  type IdentityHint,
  type FileStoreOptions,
} from "./credentials/index.js";

// 错误(errs 命名空间 + 具名类)
export {
  errs,
  CliError,
  ValidationError,
  AuthenticationError,
  PermissionError,
  ConfigError,
  NetworkError,
  APIError,
  NotFoundError,
  PolicyError,
  InternalError,
  ConfirmationRequiredError,
  BareError,
  exitCodeOf,
  categoryOfSubtype,
  SUBTYPE_REGISTRY,
  type Category,
  type Problem,
} from "./errs/index.js";

// 统一输出格式
export {
  serializeSuccess,
  serializeError,
  type Identity,
  type SerializeErrorOptions,
  type SerializeSuccessOptions,
} from "./envelope.js";

// --no-json 模式通用文本渲染(命令 humanFormat 兜底用;也可供业务自定义渲染复用)
export { prettyPrint, prettyError, printTable, type TableColumn } from "./pretty.js";

// 请求层(供自定义 transport 用)
export { createFetchAdapter, throwForResponse, type CreateFetchAdapterOptions } from "./request.js";

// 插件
export {
  sortPlugins,
  runBeforeCommand,
  beforeRequest,
  observeRequest,
  handleUnauthorized,
  transformOutput,
  observeError,
  handleError,
} from "./plugin.js";

export { rawText } from "./output.js";

// 上下文工厂
export { createContext, createStderrLog } from "./context.js";

// 管道
export { createPipeReader, emptyPipe } from "./pipe.js";

// skill 系统(reader + sync + targets + gen)
export {
  listSkills,
  listPath,
  readSkill,
  readReference,
  splitArg,
  cleanSubPath,
  parseFrontmatter,
  syncSkills,
  DEFAULT_SKILL_TARGETS,
  resolveSkillTargets,
  resolveActiveTargets,
  isTargetInstalled,
  detectInstalledTargets,
  expandTargetDir,
  flattenCommands,
  signatureLine,
  argsTable,
  generateAutogenBlock,
  refreshAutogen,
  generateSkillSkeleton,
  AUTOGEN_START,
  AUTOGEN_END,
  type SkillInfo,
  type DirEntry,
  type SkillTarget,
  type SyncResult,
  type SyncSkillsOptions,
  type SyncTargetResult,
  type GenLang,
  SkillRepository,
  type SkillRepositoryOptions,
  type GenerateSkillOptions,
  type SkillFileStore,
} from "./skills/index.js";

// 参数解析
export { parseArgs, signatureOfArgs, positionalLabel, type ParsedArgs } from "./args.js";

// 执行器
export { runCommand, type RunCommandOptions } from "./pipeline.js";

// install 向导(框架层,业务包拦截 install 命令后调)
export { runInstallWizard, type InstallWizardOptions } from "./install-wizard.js";
export { detectBizPackage, type BizPackageInfo } from "./define.js";

// OAuth 鉴权工厂(plugin.provides 自动注入 login/status/logout/register 命令)
export { defineAuth, type DefineAuthOptions } from "./auth/index.js";

// 测试工具(createTestCtx,供业务包 mock ctx 用)
export { createTestCtx, type MockRequest, type CreateTestCtxOptions } from "./test-utils.js";

// 类型
export type { App, DefineCliOptions } from "./application-contracts.js";
export type { ArgSpec, ArgsSpec, ArgType, CommandGroup, CommandSpec } from "./command-contracts.js";
export type {
  CommandResult,
  DataCommandResult,
  RawTextCommandResult,
  Meta,
  Pagination,
  PipeRecord,
  StructuredData,
} from "./output-contracts.js";
export type { ErrorDecision, Plugin, UnauthorizedDecision } from "./plugin-contracts.js";
export type {
  AttemptOutcome,
  ErrorOnStatus,
  HttpAdapter,
  RequestAttemptEvent,
  RequestOptions,
  TransportResponse,
} from "./request-contracts.js";
export type { CommandContext, CredentialsApi, LogApi, PipeApi } from "./runtime-contracts.js";
