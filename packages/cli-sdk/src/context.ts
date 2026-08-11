/** CommandContext factory backed by the single-owner RequestExecutor. */
import type {
  CommandContext,
  ErrorOnStatus,
  HttpAdapter,
  LogApi,
  PipeApi,
  Plugin,
} from "./types.js";
import { emptyPipe } from "./pipe.js";
import { createRequestExecutor } from "./request-executor.js";

/** Internal channel for one invocation's framework credential flags. */
export const credentialArgsKey: unique symbol = Symbol("rxcli.credentialArgs");

/** Internal channel for the identity selected by the auth session. */
export const identityKey: unique symbol = Symbol("rxcli.identity");

export function createStderrLog(prefix?: string): LogApi {
  const write = (level: string, message: unknown) => {
    const text =
      message instanceof Error
        ? message.message
        : typeof message === "string"
          ? message
          : JSON.stringify(message);
    process.stderr.write(prefix ? `[${prefix}] ${level}: ${text}\n` : `${level}: ${text}\n`);
  };
  return {
    info: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message) => write("ERROR", message),
  };
}

export interface CreateContextOptions<State> {
  state: State;
  adapter: HttpAdapter;
  plugins?: Plugin<State>[];
  errorOnStatus?: ErrorOnStatus;
  log?: LogApi;
  pipe?: PipeApi;
  credentials?: CommandContext<State>["credentials"];
}

export function createContext<State>(options: CreateContextOptions<State>): CommandContext<State> {
  const executor = createRequestExecutor({
    adapter: options.adapter,
    plugins: options.plugins,
    errorOnStatus: options.errorOnStatus,
  });
  const ctx: CommandContext<State> = {
    state: options.state,
    log: options.log ?? createStderrLog(),
    pipe: options.pipe ?? emptyPipe(),
    credentials: options.credentials ?? createNoopCredentials(),
    request: (request) => executor.execute(ctx, request),
    get: (path, query) => executor.execute(ctx, { method: "GET", path, query }),
    post: (path, body) => executor.execute(ctx, { method: "POST", path, body }),
    put: (path, body) => executor.execute(ctx, { method: "PUT", path, body }),
    patch: (path, body) => executor.execute(ctx, { method: "PATCH", path, body }),
    delete: (path) => executor.execute(ctx, { method: "DELETE", path }),
  };
  return ctx;
}

function createNoopCredentials(): CommandContext<unknown>["credentials"] {
  return {
    async get() {
      return null;
    },
    async save() {},
    async clear() {},
  };
}
