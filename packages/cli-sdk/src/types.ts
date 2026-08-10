/**
 * @renxqoo/agent-data-cli —— 全部核心类型定义
 *
 * 设计依据:packages/cli-sdk/docs/ 下的设计文档(00~07)。
 * 本文件是实现的类型基石,后续模块(envelope/request/pipeline/...)都从这里取类型。
 * 运行时中立:只用标准 TS/Web API,不依赖任何运行时专属 API。
 */

import type { SkillTarget } from "./skills/targets.js";

// ============================================================================
// 通用基础
// ============================================================================

/** 结构化数据:beforeOutput / run.data 允许的形态(排除 string,保护管道契约)。 */
export type StructuredData = Record<string, unknown> | unknown[] | null;

// ============================================================================
// 参数解析(命令 args spec)
// ============================================================================

export type ArgType = "string" | "number" | "boolean" | "array";

export interface ArgSpec {
  /** 字面量联合,'strin'(拼错)编译报错。 */
  type: ArgType;
  required?: boolean;
  /** 默认 flag;true 则 `<id>` 而非 `--id`。 */
  positional?: boolean;
  /** 填了进自动生成的命令文档(见 06-skills.md)。 */
  desc?: string;
  /** 简化版:不跟 type 联动。 */
  default?: unknown;
}

export type ArgsSpec = Record<string, ArgSpec>;

// ============================================================================
// 请求 / 传输
// ============================================================================

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface TransportResponse<T = unknown> {
  status: number;
  /** T 默认 unknown;ctx.get<T>() 声明响应 body 类型(可选,axios 式)。 */
  data: T;
  headers: Record<string, string>;
}

// ============================================================================
// 统一输出格式(envelope)
// ============================================================================

/** 分页元信息(命令如实填 complete + nextToken,决策清单 #9)。 */
export interface Pagination {
  /** true 表示后端数据已拉完;false 表示还有更多。agent 靠它判断是否续拉。 */
  complete: boolean;
  /** 本次响应包含的 API 页数(通常 1)。 */
  pages?: number;
  /** 本次响应包含的记录数(经过命令层过滤后)。 */
  items?: number;
  /** 续拉游标。complete:false 时通常有;complete:true 时省略。 */
  nextToken?: string;
}

export interface Meta {
  /** 本次返回的记录数(data 是数组时)。 */
  count?: number;
  pagination?: Pagination;
  /** 可选:写入操作的回滚提示(如"可用 xxx 撤销")。 */
  rollback?: string;
  /** 允许任意额外字段(业务自定义 meta + 内部标记如 _rawOutput)。下划线前缀的内部字段不进 wire。 */
  [key: string]: unknown;
}

/** run 的返回值。纯副作用命令可不 return(void 合法)。 */
export interface CommandResult<T = unknown> {
  /** 结构化业务数据(对象/数组/null)。裸标量破坏管道契约,会被运行时拒绝(见 pipeline.ts)。 */
  data: T;
  meta?: Meta;
}

// ============================================================================
// 管道(PipeRecord)
// ============================================================================

/** 下游 ctx.pipe.in() 读到的每条记录形态。stdout 仍是完整统一输出格式;框架把 data 数组逐条包成 PipeRecord。 */
export interface PipeRecord {
  /** 来源业务包命名空间(defineCli.name),下游按它分流。 */
  type: string;
  /** 稳定标识。管道传引用+ID 的核心(决策清单 #11)。 */
  id?: string;
  /** payload(已过 beforeOutput 转换)。 */
  data?: unknown;
  /** 可选元数据(来源命令、时间戳)。 */
  meta?: Record<string, unknown>;
}

// ============================================================================
// 命令上下文(ctx)
// ============================================================================

/** 命令运行时读写凭证(走 provider chain;来源是 auth 插件创建的 store,见 05-credentials.md)。 */
export interface CredentialsApi {
  get(namespace: string): Promise<Record<string, string> | null>;
  save(namespace: string, creds: Record<string, unknown>): Promise<void>;
  clear(namespace: string): Promise<void>;
}

export interface PipeApi {
  /** 异步迭代上游记录(PipeRecord)。 */
  in(): AsyncIterable<PipeRecord>;
  /** stdin 非 TTY 即管道。下游命令 run 开头用它分流。 */
  isInPipe(): boolean;
}

export interface LogApi {
  /** 强制 stderr(绝不污染 stdout/管道)。 */
  info(msg: unknown): void;
  warn(msg: unknown): void;
  error(msg: unknown): void;
}

/**
 * cli-sdk 注入给每个 run(args, ctx) 的上下文。
 * 请求方法直接挂 ctx(无 client 层);鉴权由 auth 插件 + cli-sdk 内部处理,业务包无感。
 */
export interface CommandContext<State = Record<string, never>> {
  // —— 请求方法(直接挂 ctx,无 client 层)——
  // T 是响应 body 类型,可选(不写则 data 是 unknown)
  get<T = unknown>(path: string, query?: Record<string, unknown>): Promise<TransportResponse<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>;
  put<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>;
  delete<T = unknown>(path: string): Promise<TransportResponse<T>>;
  /** 低层兜底。 */
  request<T = unknown>(opts: RequestOptions): Promise<TransportResponse<T>>;

  // —— state:插件间共享数据,强类型(defineCli<State> 声明)——
  state: State;

  // —— 日志:强制 stderr ——
  log: LogApi;

  // —— 管道:作为下游时读上游记录 ——
  pipe: PipeApi;

  // —— 凭证(运行时读写,见 05-credentials.md)——
  credentials: CredentialsApi;
}

// ============================================================================
// 命令定义(CommandSpec)
// ============================================================================

/**
 * 命令结构。命令级只有 Args/Result 两个泛型;
 * State 由 defineCli<State> 统一注入(ctx.state),命令定义时不写 State。
 */
export interface CommandSpec<Args = any, Result = unknown> {
  /** 必填,缺了编译报错。 */
  name: string;
  description: string;
  /** 可选(解析规范)。 */
  args?: ArgsSpec;
  /** 可选:内部命令(skills list/read/sync/gen 等)跳过插件 beforeCommand(不走 auth/凭证校验)。 */
  internal?: boolean;
  /**
   * 可选:--no-json 模式的人类可读输出(命令自定义)。
   * 不声明时用框架通用兜底 prettyPrint。声明了就用命令的(如表格、特殊排版)。
   */
  humanFormat?: (data: unknown, meta?: Meta) => string;
  run: (args: Args, ctx: CommandContext<any>) => Promise<CommandResult<Result> | void>;
}

/** 命令组:key 决定子命令名(defineCommands 的 key 即命令名)。 */
export type CommandGroup = Record<string, CommandSpec>;

// ============================================================================
// 插件(Plugin)
// ============================================================================

/**
 * vite 式插件:带 name 的独立对象,可组合、可复用、可分发(独立 npm)。
 * 钩子是 Plugin 接口,不是 defineCli 的内联配置(决策清单 #6)。
 */
export interface Plugin<State = Record<string, never>> {
  /** 必填:插件名(日志/溯源)。 */
  name: string;
  /** 可选:执行优先级,省略 = 'normal' 档(三档:pre/normal/post)。 */
  enforce?: "pre" | "normal" | "post";
  /**
   * 可选:plugin 贡献的命令,defineCli 自动注入,业务无需手挂。
   *
   * 合并规则(与 defineCli 的 commands/namespaces):
   *   - 同 namespace 不同命令 → 合并(plugin 给 login,业务加 register,合一起)
   *   - 同 namespace 同命令 → defineCli 赢(plugin 给默认,业务能覆盖)
   *
   * ```ts
   * const authPlugin: Plugin = {
   *   name: 'auth',
   *   provides: { namespaces: { auth: { login, status, logout } } },
   *   beforeCommand(ctx) { /* 注入 token *\/ },
   * }
   * // → rxcli auth login 自动可用,无需在 defineCli 里手挂 namespaces.auth
   * ```
   */
  provides?: {
    /** 贡献命名空间组(同 DefineCliOptions.namespaces 类型)。 */
    namespaces?: Record<string, CommandGroup>;
    /** 贡献顶层命令(挂顶层 → rxcli <cmd>)。 */
    commands?: CommandGroup;
  };
  beforeCommand?(ctx: CommandContext<State>): Promise<void>;
  beforeRequest?(ctx: CommandContext<State>, req: RequestOptions): Promise<void>;
  afterRequest?(ctx: CommandContext<State>, res: TransportResponse): Promise<void>;
  /**
   * 收到 401 时尝试续期。string=新 token 并重试；null=已尝试但失败；undefined=本插件不适用。
   * 续期状态必须绑定 ctx，禁止放在可复用 plugin 的闭包里。
   */
  onUnauthorized?(
    ctx: CommandContext<State>,
    req: RequestOptions,
  ): Promise<string | null | undefined>;
  beforeOutput?(ctx: CommandContext<State>, data: unknown): Promise<StructuredData>;
  onError?(ctx: CommandContext<State>, err: unknown): Promise<unknown | void>;
}

// ============================================================================
// defineCli 装配(App)
// ============================================================================

/** errorOnStatus 的值:status(数字或 '5xx' 形态)→ subtype 字符串(隐含 category)。 */
export type ErrorOnStatus = Record<number | `${number}xx`, string>;

export interface DefineCliOptions<State> {
  /** 必填:命名空间(PipeRecord.type 兜底、skill 标识用)。如 'orders'、'customers'。 */
  name: string;
  /**
   * 可选:终端 bin 名(help 显示 / SKILL.md 命令签名用)。
   * 业务包显式声明用户真实敲的命令名(如 'rxcli-orders')。
   * 不填则默认用 name(SKILL.md 签名会显示 name <cmd>)。
   */
  binName?: string;
  description: string;
  /** 可选:所有扩展(含 auth)。入门示例可省略(默认 []);有 auth 需求的业务包传入 auth 插件。 */
  plugins?: Plugin<State>[];
  /** 必填:顶层命令组(key=命令名)→ <binName> <cmd>。 */
  commands: CommandGroup;
  /** 可选:子命名空间组(key=子命名空间)→ rxcli-<name> <ns> <cmd>;单业务域不填。 */
  namespaces?: Record<string, CommandGroup>;
  /** 可选:skill 目录(默认 ./skills)。 */
  skillsDir?: string;
  /**
   * 可选:skills 源 URL(install 向导用)。
   * 设了 → install 向导优先 `npx skills add <url>`(覆盖 30+ AI 工具发现路径);
   * 空/未设 → 用包内本地 skills(走 `rxcli skills sync`,写入所有默认 agent 发现目录)。
   */
  skillsSource?: string;
  /**
   * 可选:skill 同步目标(AI agent 工具发现目录列表)。
   * 省略 → 框架内置默认 7 个:`~/.agents`、`~/.claude`、`~/.codex`、`~/.cursor`、
   *   `~/.zcode`、`~/.openclaw`、`~/.pi/agent`(均下的 skills 子目录,见 skills/targets.ts)。
   * 传非空数组 → 完全覆盖默认列表(只同步到你指定的目录)。
   * 传空数组 [] → 不同步到任何目录(关闭多 target,仅 install 向导的 npx 路径生效)。
   */
  skillsTargets?: SkillTarget[];
  /**
   * 可选:per-skill 命令过滤(命令文档分片)。
   *
   * key = skill 目录名,value = 该 skill 覆盖的 namespace / 顶层命令名列表。
   * `skills gen <name>` 据此只把 scope 内的命令写进该 skill 的 AUTO-GEN 块,
   * 让一个 CLI 拆成多个聚焦 skill 时,每个 skill 的命令表只列自己的域。
   *
   * 省略或某 skill 未列出 → 该 skill 的 AUTO-GEN 块含全部命令(旧行为,向后兼容)。
   */
  skillsScopes?: Record<string, string[]>;
  /** 可选:status→错误自动 throw(subtype 隐含 category)。 */
  errorOnStatus?: ErrorOnStatus;
  /** 可选:后端 baseUrl(无 auth 时可直连;有 auth 时由 provider 决定)。 */
  baseUrl?: string;
  /**
   * 可选:--no-json 文本 / JSON 统一输出的默认输出格式(用户没传 --json/--no-json 时)。
   *
   * - `'auto'`(默认,推荐):stdout 是 TTY(人在终端)→ 文本;非 TTY(管道/脚本/CI)→ JSON。两全。
   * - `'json'`:默认 JSON 统一输出(agent-native 业务选这个)。
   * - `'human'`:默认人类可读文本(面向终端用户的业务选这个)。
   *
   * `--json` / `--no-json` 永远强制覆盖本选项。
   * 管道保护:被管道(stdin 非 TTY)时,即使默认文本也强制 JSON(保护 agent)。
   */
  defaultFormat?: "json" | "human" | "auto";
  /** 可选:引导文案 i18n。 */
  messages?: Record<string, unknown>;
}

/**
 * defineCli 返回的 App 对象。
 * bin 入口检测 import.meta.url 决定是否自动 run;
 * 也可被测试/宿主直接调 run(argv) 驱动。
 */
export interface App {
  /** 装配名(defineCli.name)。 */
  name: string;
  /** 解析 argv 并执行匹配的命令(渲染统一输出到 stdout/stderr + 设 exit code)。 */
  run(argv: string[]): Promise<void>;
}
