# 鉴权进阶:手写 auth Plugin、自定义 provider

> 主 SKILL.md 里的 `defineAuth` 工厂覆盖 90% 场景(标准 OAuth device flow / Bearer / API key)。下面讲 register / split-flow 实战,以及剩下 10% 的手写 auth Plugin。

---

## 0. defineAuth 贡献了什么(register + split-flow 实战)

`defineAuth({ ... })` 一行同时给你:

| 贡献                   | 说明                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **4 个 auth 命令**     | `login` / `status` / `logout` / `register`(通过 `provides.namespaces.auth` 自动注入到 `<bin> auth <cmd>`) |
| **login 三分支**       | 默认阻塞轮询(人类)/ `--no-wait --json`(发起,立即返回)/ `--device-code <code>`(完成轮询)                   |
| **register 命令**      | 用注册令牌换独立 clientId/Secret,写 `~/.rxcli/config.json`                                                |
| **beforeCommand 钩子** | 跑 provider chain 取 token → 填 `ctx.credentials` / `ctx.state.user`                                      |
| **beforeRequest 钩子** | 按 `authStyle` 注入 header(bearer/x-api-key/basic)                                                        |
| **on401 续期 hook**    | `_transportConfig.on401`(singleflight refresh + 落盘 + 重跑 request hooks 后重试一次)                     |
| **精确豁免**           | `auth login/register` 等自动跳过自身 `beforeCommand`(不会被"必须登录"拦截)                                |

### ⚠️ 最小用法(永远 await,这是高频致命坑)

`defineAuth` 是 **`async`** 函数,返回 `Promise<Plugin>`。**必须 `await`**:

```ts
// src/index.ts(或 src/auth.ts 导出,这里展示入口内联)
import { defineCli, defineAuth } from "@renxqoo/agent-data-cli";

// ✅ 正确:await 拿到的是 Plugin
const auth = await defineAuth({
  credentialNamespace: "rxweather",
  baseUrl: process.env.AUTH_BASE_URL!,
  scope: "weather:read offline_access",
});

defineCli({
  name: "rxweather",
  plugins: [auth], // auth 是 Plugin,鉴权链生效
  // ...
});
```

```ts
// ❌ 错误:忘 await → auth 是 Promise → plugins:[Promise] → 鉴权链全废,运行即崩且无报错
const auth = defineAuth({ ... })
defineCli({ plugins: [auth], ... })
```

> 这是鉴权场景**最高频的 bug**。本文件所有 `defineAuth` 示例都 `await`——照抄即可。若把 auth 工厂拆到单独 `src/auth.ts` 导出,那里也必须 `await` 后再 `export`(不能 `export const auth = defineAuth(...)`)。

### 首次使用顺序(铁律)

```
register(注册令牌 → clientId/Secret,写 ~/.rxcli/config.json)
   ↓
login(OAuth device flow → token,写 ~/.rxcli/credentials/<ns>.json)
   ↓
业务命令(orders list / ...)
```

跳过 register 直接 login → `device_authorization failed`(401 invalid_client)。

### clientId / Secret 的回填优先级

`defineAuth` 不传 `clientId/clientSecret` 时:

1. `process.env.RXCLI_CLIENT_ID` / `RXCLI_CLIENT_SECRET`(CI/临时覆盖)
2. `~/.rxcli/config.json`(register 写入,持久化)
3. 空(向后兼容未注册态,login 会失败提示 register)

### agent 登录必须用 split-flow

> 主 SKILL.md §7 已讲,这里给命令细节。**业务 SKILL.md 必须把这段教给使用者。**

```bash
# 第一步:发起(当前轮,立即返回)
my-cli auth login --no-wait --json
# → {"ok":true,"data":{"device_code":"...","verification_url":"https://...","expires_in":300,...}}
#   记住 data.device_code

# 1.5:生成二维码给用户扫码(框架自动注入的顶层 qrcode 命令)
my-cli qrcode <verification_url> --output /tmp/login-qr.png
# → 把 URL 文本 + 二维码图片一起给用户

# 第二步:用户在浏览器完成授权后,完成登录(下一轮)
my-cli auth login --device-code <第一步的 device_code>
# → stderr "✓ 登录成功:<name>",token 写入 ~/.rxcli/credentials/<ns>.json
```

**禁止**:agent 在同一轮展示 URL 后立刻跑 `--device-code`(harness 不透传中间输出,用户看不到 URL);缓存 `device_code`/`verification_url`(几分钟过期,每次重新发起)。

### install 向导(4 步,分发 CLI 用)

框架自带 install 向导,把"装包 → 装 skills → register → login"串成一键流程。业务包入口拦截 `argv[0]==='install'` 转给它:

```ts
// src/index.ts(bin 入口)。注意用 realpath 比对入口,npm 全局安装时 argv[1] 是 bin 软链
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const argv = process.argv.slice(2);
if (isMainEntry() && argv[0] === "install") {
  const { runInstallWizard } = await import("@renxqoo/agent-data-cli");
  await runInstallWizard({ skillsSource: process.env.X_SKILLS_SOURCE });
  process.exit(0);
}
if (isMainEntry()) app.run(argv);
```

**4 步流程**(向导自动跑,无需手写):

1. `npm install -g <业务包名>`(由 `detectBizPackage()` 从 package.json 探测,不是问用户)
2. 装 skills:`skillsSource` 设了 → `npx skills add <url>`;空 → `<bin> skills sync`
3. `<bin> auth register`(若 `~/.rxcli/config.json` 无 clientId)
4. `<bin> auth login`(失败仅 warn,不阻断)

**传给 `runInstallWizard` 的 `skillsSource` 决定 skills 怎么装**:空 → 本地 `skills/` 同步到 `~/.agents/skills/`;设 URL → `npx skills add`(覆盖 30+ AI 工具发现路径)。当前 `defineCli({ skillsSource })` 不会自动转交该配置。

---

## 1. 什么时候不用 `defineAuth`

| 场景                                          | 用什么                                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| 标准 OAuth(OAuth 中间层 + device flow)        | `defineAuth` 工厂(含 register/split-flow/401 续期,见 §0)        |
| Bearer / API key / Basic(单 token,无 refresh) | `defineAuth({ authStyle: 'x-api-key' \| 'bearer' \| 'basic' })` |
| HMAC 签名(非 header 注入,要算签名)            | 手写 auth Plugin(下面 §3)+ 自定义 Provider                      |
| mTLS(客户端证书)                              | 手写 auth Plugin + 自定义 Provider + `beforeRequest` 注入证书   |
| 复合鉴权(签名 + header)                       | 手写 auth Plugin + 签名 Plugin(`enforce:'post'`)                |

---

## 2. auth Plugin 是什么

**它就是一个普通的 `Plugin` 对象**,用 cli-sdk 导出的基础块组装:

```ts
import {
  type Plugin,
  type CommandContext,
  type ProviderContext,
  fileStore,
  defaultProviders,
  resolveWithChain,
  resolveIdentityWithChain,
  injectAuthHeader,
  createOn401Hook,
  AuthenticationError,
} from "@renxqoo/agent-data-cli";
```

**3 个出口的职责:**

| 出口                     | 做什么                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `beforeCommand`          | 跑 provider chain 取 token → 包装 store 成 `ctx.credentials` → 填 `ctx.state.user` → 缓存 token      |
| `beforeRequest`          | 用 `injectAuthHeader(req, token, authStyle)` 按 style 注入 header                                    |
| `_transportConfig.on401` | `createOn401Hook(...)` 返回的 hook 挂这里;cli-sdk 请求层遇到 401 时调它(singleflight refresh + 重试) |

---

## 3. 手写 auth Plugin 骨架

```ts
// src/auth.ts
import {
  type Plugin,
  type CommandContext,
  type ProviderContext,
  fileStore,
  defaultProviders,
  resolveWithChain,
  resolveIdentityWithChain,
  injectAuthHeader,
  createOn401Hook,
  AuthenticationError,
} from "@renxqoo/agent-data-cli";
import { homedir } from "node:os";
import { join } from "node:path";

export function createMyAuth<State extends { user?: unknown }>(opts: {
  namespace: string;
  authStyle?: "bearer" | "x-api-key" | "basic";
  oauth?: { baseUrl: string; clientId: string; clientSecret: string };
}): Plugin<State> & { _transportConfig?: { on401?: () => Promise<string | null> } } {
  const store = fileStore({ dir: join(homedir(), ".my-cli") });
  const providers = defaultProviders();
  const authStyle = opts.authStyle ?? "bearer";
  const on401 = opts.oauth
    ? createOn401Hook({ cfg: opts.oauth, store, namespace: opts.namespace })
    : undefined;

  return {
    name: `auth:${opts.namespace}`,
    enforce: "pre", // ★ 鉴权必须 pre,先填 token 再发请求
    _transportConfig: on401 ? { on401 } : undefined,

    async beforeCommand(ctx: CommandContext<State>) {
      const pctx: ProviderContext = {
        namespace: opts.namespace,
        configStore: store,
        args: {},
        env: process.env,
      };
      const resolved = await resolveWithChain(providers, pctx);
      if (!resolved) {
        throw new AuthenticationError({
          subtype: "no_credentials",
          message: `${opts.namespace} 未配置凭证`,
          hint: `设置 \${opts.namespace.toUpperCase()}_API_KEY 环境变量或运行 \`my-cli auth login\``,
        });
      }

      // 把 store 包装成 ctx.credentials(命令运行时 API)
      (ctx as { credentials: typeof ctx.credentials }).credentials = {
        get: async (ns) => (await store.loadCredentials(ns)) as Record<string, string> | null,
        save: (ns, d) => store.saveCredentials(ns, d),
        clear: (ns) => store.clearCredentials(ns),
      };

      // 填 identity(统一输出格式顶层 user/bot + state.user)
      const identity = await resolveIdentityWithChain(providers, pctx);
      if (identity) {
        (ctx as unknown as { _identity?: typeof identity })._identity = identity;
        (ctx.state as Record<string, unknown>).user = {
          ...(identity.userId ? { userId: identity.userId } : {}),
          ...(identity.name ? { name: identity.name } : {}),
        };
      }

      // 缓存 token 给 beforeRequest
      (ctx as unknown as { _authToken?: string })._authToken = resolved.token.token;
    },

    async beforeRequest(ctx, req) {
      const token = (ctx as unknown as { _authToken?: string })._authToken;
      if (token) injectAuthHeader(req, token, authStyle);
    },
  };
}
```

用法:

```ts
// src/index.ts
import { createMyAuth } from './auth.js'
const auth = createMyAuth({
  namespace: 'my-cli',
  authStyle: 'bearer',
  oauth: { baseUrl: process.env.AUTH_BASE_URL!, clientId: process.env.CLIENT_ID!, clientSecret: process.env.CLIENT_SECRET! },
})
defineCli({ plugins: [auth], ... })
```

### ⚠️ provides 的 login/logout 命令:直接用 `store`,别用 `ctx.credentials`

上面的骨架在 `beforeCommand` 里把 `store` 包装成了 `ctx.credentials`。**但如果你通过 `provides` 贡献了 login/logout 命令,这些命令会被框架精确豁免自身 beforeCommand**(见主 SKILL.md §3 plugin provides 机制)——豁免后 `ctx.credentials` 是框架默认的 no-op(`save`/`clear` 空跑),login 调 `ctx.credentials.save()` **什么都不会写**。

**正确写法**:login/logout 直接用闭包里的 `store`(和 `defineAuth` 工厂内部一致),不经过 `ctx.credentials`:

```ts
// ✅ 正确:login/logout 直接用 store 落盘
const authCommands = defineCommands({
  login: defineCommand({
    name: "login",
    args: { apiKey: { type: "string", required: true } },
    async run(args, _ctx) {
      await store.saveCredentials(opts.namespace, { apiKey: args.apiKey });
      return { data: { saved: true } };
    },
  }),
  logout: defineCommand({
    name: "logout",
    async run(_args, _ctx) {
      await store.clearCredentials(opts.namespace);
      return { data: { cleared: true } };
    },
  }),
});

// plugin 里 provides 这组命令
return {
  name: `auth:${opts.namespace}`,
  enforce: "pre",
  provides: { namespaces: { auth: authCommands } },
  async beforeCommand(ctx) { /* ... 见上面骨架 ... */ },
  async beforeRequest(ctx, req) { /* ... */ },
};

// ❌ 错误:login 里用 ctx.credentials.save()
//   login 被 provides 豁免 beforeCommand → ctx.credentials 是 no-op → 不落盘!
//   async run(args, ctx) { await ctx.credentials.save(...) }  // ← bug!
```

> 判断规则:**`provides` 贡献的命令里,凭证读写一律用 `store`(闭包),不用 `ctx.credentials`**。`ctx.credentials` 只在业务命令(非 plugin provides)里可靠——那时 beforeCommand 已跑过,包装已生效。

---

## 4. provider chain 怎么工作

```ts
resolveWithChain(providers, pctx) 按 priority 升序逐个尝试:
  flagProvider  (priority 1)  → --api-key <key> 全局 flag(临时覆盖)
  envProvider   (priority 5)  → $NS_API_KEY 环境变量
  fileProvider  (priority 10) → ~/.my-cli/credentials/<ns>.json 的 apiKey/token
  oauthProvider (priority 20) → 同一文件里的 OAuth token(含 refresh_token)
```

**命中即停**:第一个返回非 null 的 provider 用它的 token;全 null → auth Plugin 抛 `AuthenticationError`。

`defaultProviders()` 默认装好这 4 个。**业务包通常不用关心**——只有自定义鉴权(HMAC/mTLS)时才自己 `providers = [...defaultProviders(), customProvider]`。

---

## 5. 自定义 Provider(HMAC 例子)

```ts
// src/hmac-provider.ts
import type { CredentialProvider, ProviderContext, TokenResult } from "@renxqoo/agent-data-cli";

export class HmacProvider implements CredentialProvider {
  constructor(private opts: { namespace: string; accessKeyId?: string }) {}
  name() {
    return "hmac";
  }
  priority() {
    return 15;
  } // 在 file(10)之后、oauth(20)之前

  async resolveToken(pctx: ProviderContext): Promise<TokenResult | null> {
    const creds = await pctx.configStore.loadCredentials(this.opts.namespace);
    if (!creds?.accessKey || !creds?.secretKey) return null;
    return { token: creds.accessKey as string, type: "custom", source: "hmac" };
  }
}
```

签名单独写一个 `enforce:'post'` 插件(post 档 = 等所有 header 定型后再签名):

```ts
// src/hmac-sign-plugin.ts
import { createHmac } from "node:crypto";
import type { Plugin } from "@renxqoo/agent-data-cli";

export function hmacSignPlugin(namespace: string): Plugin {
  return {
    name: "hmac-sign",
    enforce: "post",
    async beforeRequest(ctx, req) {
      const creds = await ctx.credentials.get(namespace);
      if (!creds?.secretKey) return;
      const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
      const sig = createHmac("sha256", creds.secretKey as string)
        .update(`${req.method}\n${req.path}\n${body}`)
        .digest("hex");
      req.headers["X-Signature"] = sig;
    },
  };
}
```

用法:

```ts
defineCli({
  plugins: [
    createMyAuth({ namespace: "my-cli", authStyle: "x-api-key" }),
    hmacSignPlugin("my-cli"),
  ],
});
```

---

## 6. 401 自动续期(singleflight)

**业务包不处理 401**,cli-sdk 请求层自动:

1. 收到 401 → 调 `_transportConfig.on401` hook
2. hook 用 `createOn401Hook({ cfg, store, namespace })` 创建,内部:
   - 读当前凭证拿 refreshToken
   - 用 singleflight(同一 refreshToken 复用同一个 refresh Promise,避免并发重复 refresh)
   - 续期成功后**落盘**(修正 v1 坑:续期成功必须写回 credentials.json)
3. 拿到新 token → 重试一次原请求
4. 重试仍 401 → 抛 `AuthenticationError(token_expired)`,触发用户重新登录

**前提**:auth Plugin 必须挂 `_transportConfig.on401`。**没挂的 auth Plugin 不支持 401 自动续期。**

重试会先替换现有认证 header（大小写不敏感），并重新执行全部 `beforeRequest` hook，因此 Bearer / X-Api-Key / Basic 以及 HMAC nonce、时间戳、签名都会按新 token 重算。任何最终 401 都是认证错误，不会因为遗漏 `errorOnStatus` 而被当成成功响应。

`--api-key <key>` 是框架级一次性凭证，只定向提供给 auth provider chain，不会混入业务命令 args 或暴露给其他 telemetry/plugin hook；裸 `--api-key` 会在命令运行前得到 validation 错误。

---

## 7. 自定义凭证存储路径(隔离多 CLI 的关键)

> ⚠️ **重要:`defineAuth` 默认所有 CLI 共用 `~/.rxcli/`,无自动隔离**(`auth/index.ts:107` 硬编码)。凭证靠 `credentialNamespace` 区分(`<dir>/credentials/<ns>.json`)。若两个 CLI 的 namespace 撞了 → **静默共用同一份凭证**,这是真坑。

**两种隔离策略:**

**(a) 默认共享 `~/.rxcli`,靠 namespace 区分**(适合同一家公司的多个 CLI,token 可复用):

```ts
const auth = await defineAuth({
  credentialNamespace: "crm", // → ~/.rxcli/credentials/crm.json
  baseUrl: AUTH_BASE_URL,
});
```

**(b) 完全独立目录**(适合独立产品,不想和其他 CLI 共用任何文件):

```ts
import { fileStore } from "@renxqoo/agent-data-cli";
import { join } from "node:path";
import { homedir } from "node:os";

const store = fileStore({ dir: join(homedir(), ".my-cli") }); // → ~/.my-cli/credentials/<ns>.json
const auth = await defineAuth({
  credentialNamespace: "my-cli",
  baseUrl: AUTH_BASE_URL,
  store, // ★ 注入自定义 store 覆盖默认 ~/.rxcli
});
```

> 注意:`store` 选项在源码里标注"测试用",但它是**唯一**覆盖默认目录的方式。生产用没问题,只是 API 没正式列为业务选项。

测试用 `memoryStore({ credentials: { 'my-cli': { apiKey: 'sk_test' } } })`(不碰磁盘)。

---

## 8. provider 接口(写自定义 Provider 时用)

```ts
export interface CredentialProvider {
  name(): string; // provider 名(日志/溯源)
  priority?(): number; // 优先级,小值先试,默认 10
  resolveToken(pctx: ProviderContext): Promise<TokenResult | null>; // null = 没有,chain 继续
  resolveIdentity?(pctx: ProviderContext): Promise<IdentityHint | null>; // 可选:填统一输出格式顶层的 user/bot
}

export interface ProviderContext {
  namespace: string; // 命名空间
  configStore: ConfigStore; // 直接读写文件(不走 chain)
  args: Record<string, unknown>; // 命令参数(读 --api-key 等)
  env: NodeJS.ProcessEnv; // 环境变量
}

export interface TokenResult {
  token: string;
  type: "api-key" | "bearer" | "basic" | "custom";
  scopes?: string[];
  source: string; // 来源描述
  expiresAt?: number;
  refreshToken?: string;
}
```

**注意区分两个 API**:

- `ctx.credentials.get/save/clear` —— 业务运行时用(走 provider chain)
- `configStore.loadCredentials/saveCredentials` —— provider 内部用(直读文件,不走 chain)
