/**
 * @renxqoo/agent-data-cli —— createTestCtx(测试用 mock ctx)
 *
 * 设计依据:docs/02-sdk-guide.md "测试:vitest + createTestCtx"。
 * 业务包用它 mock ctx 测 run 逻辑:mock request 方法(高层 get/post 都走 request,
 * mock request 即可覆盖全部业务逻辑),不需要起真实 server。
 */

import type {
  CommandContext,
  RequestOptions,
  TransportResponse,
  PipeApi,
  LogApi,
} from "./types.js";
import { createTransport, type Transport } from "./request.js";
import { createContext, createStderrLog } from "./context.js";

/** mock 的 request 函数:接收 RequestOptions,返回 TransportResponse。 */
export type MockRequest = (opts: RequestOptions) => Promise<TransportResponse> | TransportResponse;

export interface CreateTestCtxOptions<State> {
  /** mock request(高层 get/post 都走它)。不传则返回空 200。 */
  request?: MockRequest;
  /** 初始 state。 */
  state?: State;
  /** 自定义 log(默认静默,不污染测试输出)。 */
  log?: LogApi;
  /** 自定义 pipe。 */
  pipe?: PipeApi;
}

/**
 * 创建测试用 ctx。业务包直接调 run(args, ctx) 测逻辑:
 *
 * ```ts
 * const ctx = createTestCtx({
 *   request: async (opts) => {
 *     if (opts.path === '/orders') return { status: 200, data: { items: [...] }, headers: {} }
 *     throw new Error(`unexpected ${opts.path}`)
 *   },
 * })
 * const result = await cmd.run({ limit: 30 }, ctx)
 * expect(result.data).toEqual([...])
 * ```
 */
export function createTestCtx<State = Record<string, never>>(
  opts: CreateTestCtxOptions<State> = {},
): CommandContext<State> {
  // 把 mock request 包成 Transport
  const transport: Transport = {
    request: async <T = unknown>(reqOpts: RequestOptions): Promise<TransportResponse<T>> => {
      const res = opts.request
        ? await opts.request(reqOpts)
        : { status: 200, data: undefined, headers: {} };
      // T 是名义类型,mock 实现统一返回 unknown;运行时值由调用方断言
      return res as TransportResponse<T>;
    },
    get: (path, query) => transport.request({ method: "GET", path, query }),
    post: (path, body) => transport.request({ method: "POST", path, body }),
    put: (path, body) => transport.request({ method: "PUT", path, body }),
    patch: (path, body) => transport.request({ method: "PATCH", path, body }),
    delete: (path) => transport.request({ method: "DELETE", path }),
  };

  return createContext<State>({
    state: (opts.state ?? {}) as State,
    transport,
    log: opts.log ?? createSilentLog(),
    pipe: opts.pipe ?? createEmptyTestPipe(),
  });
}

/** 静默 log(测试默认不输出)。 */
function createSilentLog(): LogApi {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

/** 测试用空 pipe。 */
function createEmptyTestPipe(): PipeApi {
  return {
    async *in() {
      /* 无数据 */
    },
    isInPipe() {
      return false;
    },
  };
}
