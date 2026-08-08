/**
 * @renxqoo/agent-data-cli —— CommandContext 工厂
 *
 * 设计依据:docs/02-sdk-guide.md "ctx:请求与上下文"。
 * ctx 把 transport 的请求方法经过 plugin beforeRequest/afterRequest 包装后挂上,
 * 让命令 run 内 ctx.get(...) 时自动触发插件钩子(加 header / 签名 / 审计等)。
 */

import type {
  CommandContext,
  RequestOptions,
  TransportResponse,
  Plugin,
  LogApi,
  PipeApi,
} from "./types.js";
import type { Transport } from "./request.js";
import { runBeforeRequest, runAfterRequest } from "./plugin.js";

// ============================================================================
// 默认 log(强制 stderr)
// ============================================================================

/** 默认 log 实现:全部写 stderr(绝不污染 stdout/管道)。 */
export function createStderrLog(prefix?: string): LogApi {
  const write = (level: string, msg: unknown) => {
    const text =
      msg instanceof Error ? msg.message : typeof msg === "string" ? msg : JSON.stringify(msg);
    process.stderr.write(prefix ? `[${prefix}] ${level}: ${text}\n` : `${level}: ${text}\n`);
  };
  return {
    info: (m) => write("INFO", m),
    warn: (m) => write("WARN", m),
    error: (m) => write("ERROR", m),
  };
}

// ============================================================================
// createContext
// ============================================================================

export interface CreateContextOptions<State> {
  state: State;
  transport: Transport;
  plugins?: Plugin<State>[];
  log?: LogApi;
  pipe?: PipeApi;
  /** 凭证 API(由 auth 插件注入;无 auth 时为 no-op)。 */
  credentials?: CommandContext<State>["credentials"];
}

/**
 * 创建 CommandContext。请求方法经过 plugin beforeRequest/afterRequest 包装。
 * 命令 run 内调 ctx.get(...) → runBeforeRequest(改 req) → transport.request → runAfterRequest(审计)。
 */
export function createContext<State>(opts: CreateContextOptions<State>): CommandContext<State> {
  const plugins = opts.plugins ?? [];
  const log = opts.log ?? createStderrLog();

  // 包装 transport.request:前后插 plugin 钩子
  async function request<T>(reqOpts: RequestOptions): Promise<TransportResponse<T>> {
    await runBeforeRequest(plugins, ctx, reqOpts);
    const res = await opts.transport.request<T>(reqOpts);
    await runAfterRequest(plugins, ctx, res);
    return res;
  }

  const ctx: CommandContext<State> = {
    state: opts.state,
    log,
    pipe: opts.pipe ?? createEmptyPipe(),
    credentials: opts.credentials ?? createNoopCredentials(),
    request,
    get: (path, query) => request({ method: "GET", path, query }),
    post: (path, body) => request({ method: "POST", path, body }),
    put: (path, body) => request({ method: "PUT", path, body }),
    patch: (path, body) => request({ method: "PATCH", path, body }),
    delete: (path) => request({ method: "DELETE", path }),
  };

  return ctx;
}

// —— 无管道时的占位 pipe(空迭代,非管道)——
function createEmptyPipe(): PipeApi {
  return {
    async *in() {
      // 无数据
    },
    isInPipe() {
      return false;
    },
  };
}

// —— 无 auth 时的 no-op credentials ——
function createNoopCredentials(): CommandContext<any>["credentials"] {
  return {
    async get() {
      return null;
    },
    async save() {
      /* no-op */
    },
    async clear() {
      /* no-op */
    },
  };
}
