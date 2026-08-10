/**
 * rxcordys auth plugin —— Cordys 静态双 header 鉴权。
 *
 * Cordys 不走 OAuth device flow,而是「静态密钥对 + 三个 header」:
 *   X-Access-Key: <accessKey>
 *   X-Secret-Key: <secretKey>
 *   X-Request-Source: SKILL
 *
 * 故不用框架的 defineAuth 工厂(它面向 OAuth device flow + 单 header),
 * 改用手写 Plugin(auth-patterns.md §3 骨架):
 *   - provides.namespaces.auth 注入 login/status/logout(框架自动豁免自身 beforeCommand)
 *   - beforeCommand:读凭证(env 优先 > 文件),缺失抛 AuthenticationError(no_credentials)
 *   - beforeRequest:注入三个 header
 */

import {
  defineCommand,
  defineCommands,
  errs,
  fileStore,
  type CommandContext,
  type Plugin,
  type TransportResponse,
} from "@renxqoo/agent-data-cli";
import { CREDENTIAL_NAMESPACE, RXCLI_DIR, isBaseUrlConfigured } from "./config.js";

/** 运行时凭证(accessKey + secretKey)。 */
export interface CordysCredentials {
  accessKey: string;
  secretKey: string;
}

/** 全局 state:承载本次调用的凭证 + 来源(env / file)。 */
export interface RxCordysState {
  credentials: CordysCredentials | null;
  credentialSource: "env" | "file" | null;
}

/** 环境变量名(对齐 Cordys 原版)。 */
const ENV_ACCESS_KEY = "CORDYS_ACCESS_KEY";
const ENV_SECRET_KEY = "CORDYS_SECRET_KEY";

/** 凭证 store(磁盘,~/.rxcli/credentials/cordys.json,0600)。 */
const store = fileStore({ dir: RXCLI_DIR });

/** 从环境变量读凭证(env 优先)。 */
function readFromEnv(): CordysCredentials | null {
  const accessKey = process.env[ENV_ACCESS_KEY];
  const secretKey = process.env[ENV_SECRET_KEY];
  if (accessKey && secretKey) return { accessKey, secretKey };
  return null;
}

/** 从凭证文件读。 */
async function readFromFile(): Promise<CordysCredentials | null> {
  const creds = await store.loadCredentials(CREDENTIAL_NAMESPACE);
  const accessKey = creds?.accessKey;
  const secretKey = creds?.secretKey;
  if (typeof accessKey === "string" && typeof secretKey === "string") {
    return { accessKey, secretKey };
  }
  return null;
}

// ============================================================================
// auth 命令(login / status / logout)
// ============================================================================

const authCommands = defineCommands({
  /** login:保存密钥对到凭证文件(直接用 store 落盘,不依赖 ctx.credentials——后者因路由豁免是 no-op)。 */
  login: defineCommand<{ accessKey: string; secretKey: string }>({
    name: "login",
    description: "保存 Cordys 密钥对到凭证文件(~/.rxcli/credentials/cordys.json)",
    args: {
      accessKey: { type: "string", required: true, desc: "Cordys Access Key" },
      secretKey: { type: "string", required: true, desc: "Cordys Secret Key" },
    },
    async run(args, _ctx) {
      await store.saveCredentials(CREDENTIAL_NAMESPACE, {
        accessKey: args.accessKey,
        secretKey: args.secretKey,
      });
      return {
        data: { namespace: CREDENTIAL_NAMESPACE, saved: true },
        meta: { rollback: `rxcordys auth logout 清除已保存的密钥` },
      };
    },
  }),

  /** status:显示当前凭证来源(env / file / 未配置)。 */
  status: defineCommand({
    name: "status",
    description: "显示当前凭证来源(环境变量 / 凭证文件 / 未配置)",
    args: {},
    async run(_args, _ctx) {
      // status 被 auth plugin 豁免 beforeCommand,故不依赖 ctx.state,自行读取凭证状态。
      const envCreds = readFromEnv();
      let source: "env" | "file" | null = null;
      let configured = false;
      if (envCreds) {
        source = "env";
        configured = true;
      } else {
        const fileCreds = await readFromFile();
        if (fileCreds) {
          source = "file";
          configured = true;
        }
      }
      return {
        data: {
          configured,
          source,
          namespace: CREDENTIAL_NAMESPACE,
          file: `${RXCLI_DIR}/credentials/${CREDENTIAL_NAMESPACE}.json`,
          envVars: {
            [ENV_ACCESS_KEY]: Boolean(process.env[ENV_ACCESS_KEY]),
            [ENV_SECRET_KEY]: Boolean(process.env[ENV_SECRET_KEY]),
          },
          domainConfigured: isBaseUrlConfigured,
        },
        meta: {
          hint: !isBaseUrlConfigured
            ? "Cordys CRM domain not set: set CORDYS_CRM_DOMAIN environment variable to your Cordys CRM address (private deployment, no default)"
            : configured
              ? undefined
              : "Not configured: run `rxcordys auth login --accessKey X --secretKey Y` or set environment variables",
        },
      };
    },
  }),

  /** logout:清除凭证文件(直接用 store,不依赖 ctx.credentials)。 */
  logout: defineCommand({
    name: "logout",
    description: "清除已保存的凭证文件(不影响环境变量)",
    args: {},
    async run(_args, _ctx) {
      await store.clearCredentials(CREDENTIAL_NAMESPACE);
      return { data: { namespace: CREDENTIAL_NAMESPACE, cleared: true } };
    },
  }),
});

// ============================================================================
// auth Plugin
// ============================================================================

export function createCordysAuth(): Plugin<RxCordysState> {
  return {
    name: "cordys-auth",
    enforce: "pre", // 鉴权必须 pre,先填凭证再发请求
    provides: { namespaces: { auth: authCommands } },

    /**
     * beforeCommand:读凭证(env 优先 > 文件),填 ctx.state。
     * 缺凭证抛 AuthenticationError(no_credentials)——login/status/logout 自身被豁免。
     */
    async beforeCommand(ctx: CommandContext<RxCordysState>) {
      // 0. 后端地址必须配置(Cordys 是私有部署,无内置默认域名)
      if (!isBaseUrlConfigured) {
        throw new errs.AuthenticationError({
          subtype: "no_credentials",
          message: "Cordys CRM domain not configured",
          hint: "Set CORDYS_CRM_DOMAIN environment variable to your Cordys CRM address (e.g. https://crm.your-company.com). Cordys is a private deployment — there is no default public endpoint.",
        });
      }
      // 1. 环境变量优先(CI / 临时覆盖)
      const envCreds = readFromEnv();
      if (envCreds) {
        ctx.state.credentials = envCreds;
        ctx.state.credentialSource = "env";
        wrapCredentials(ctx);
        return;
      }
      // 2. 凭证文件(rxcordys auth login 写入)
      const fileCreds = await readFromFile();
      if (fileCreds) {
        ctx.state.credentials = fileCreds;
        ctx.state.credentialSource = "file";
        wrapCredentials(ctx);
        return;
      }
      // 3. 都没有:抛错(业务命令需要凭证)
      throw new errs.AuthenticationError({
        subtype: "no_credentials",
        message: "Cordys credentials not configured",
        hint: "Run `rxcordys auth login --accessKey <X> --secretKey <Y>` to save, or set CORDYS_ACCESS_KEY / CORDYS_SECRET_KEY environment variables",
      });
    },

    /**
     * beforeRequest:注入三个 Cordys header。
     * 双 header 是 Cordys 的契约,框架 injectAuthHeader 只支持单 header,故手写。
     */
    async beforeRequest(ctx: CommandContext<RxCordysState>, req) {
      const creds = ctx.state.credentials;
      if (!creds) return; // 内部命令(skills)可能无凭证,不阻断
      req.headers ??= {};
      req.headers["X-Access-Key"] = creds.accessKey;
      req.headers["X-Secret-Key"] = creds.secretKey;
      req.headers["X-Request-Source"] = "SKILL";
    },
  };
}

/**
 * 把 store 包装成 ctx.credentials(运行时 API),让 auth login/logout 命令能写盘。
 * 框架默认 ctx.credentials 是 no-op;有 auth plugin 时需自行注入。
 */
function wrapCredentials(ctx: CommandContext<RxCordysState>): void {
  (ctx as { credentials: CommandContext<RxCordysState>["credentials"] }).credentials = {
    get: async (ns) => (await store.loadCredentials(ns)) as Record<string, string> | null,
    save: (ns, d) => store.saveCredentials(ns, d),
    clear: (ns) => store.clearCredentials(ns),
  };
}

/**
 * 重新加载凭证(测试用:login 写盘后重新读)。
 * 业务命令运行期不需要调 —— beforeCommand 已在 run 前填好 state。
 */
export async function loadCredentialsForTest(): Promise<CordysCredentials | null> {
  return readFromEnv() ?? (await readFromFile());
}

/** 测试辅助:直接用指定 store 构造 auth(隔离 ~/.rxcli)。 */
export function createCordysAuthWithStore(testStore: {
  loadCredentials(ns: string): Promise<Record<string, unknown> | null>;
  saveCredentials(ns: string, d: Record<string, unknown>): Promise<void>;
  clearCredentials(ns: string): Promise<void>;
}): Plugin<RxCordysState> {
  return {
    name: "cordys-auth",
    enforce: "pre",
    provides: { namespaces: { auth: authCommands } },
    async beforeCommand(ctx) {
      const envCreds = readFromEnv();
      if (envCreds) {
        ctx.state.credentials = envCreds;
        ctx.state.credentialSource = "env";
        return;
      }
      const creds = await testStore.loadCredentials(CREDENTIAL_NAMESPACE);
      const accessKey = creds?.accessKey;
      const secretKey = creds?.secretKey;
      if (typeof accessKey === "string" && typeof secretKey === "string") {
        ctx.state.credentials = { accessKey, secretKey };
        ctx.state.credentialSource = "file";
        return;
      }
      throw new errs.AuthenticationError({
        subtype: "no_credentials",
        message: "Cordys credentials not configured (test store)",
        hint: "Run `rxcordys auth login`",
      });
    },
    async beforeRequest(ctx, req) {
      const creds = ctx.state.credentials;
      if (!creds) return;
      req.headers ??= {};
      req.headers["X-Access-Key"] = creds.accessKey;
      req.headers["X-Secret-Key"] = creds.secretKey;
      req.headers["X-Request-Source"] = "SKILL";
    },
  };
}

/** 校验响应是否为鉴权失败(Cordys 的 ACCESS_DENIED / INVALID_KEY 业务码,测试辅助)。 */
export function isAuthFailure(res: TransportResponse): boolean {
  const data = res.data as { code?: number } | undefined;
  return res.status === 401 || data?.code === 401;
}
