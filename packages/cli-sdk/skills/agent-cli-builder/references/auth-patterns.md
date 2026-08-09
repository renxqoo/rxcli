# 鉴权:`defineAuth` 工厂(OAuth device flow / Bearer / API key)

> 主 SKILL.md §3① 讲了 `defineAuth` 必须 `await`。这里讲完整用法:register、split-flow 登录、install 向导、凭证隔离。覆盖 90% 场景。
>
> 自定义鉴权(HMAC 签名、mTLS、手写 provider chain)见 `references/custom-auth-plugin.md`。

---

## 0. defineAuth 贡献了什么

`defineAuth({ ... })` 一行同时给你:

| 贡献                   | 说明                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **4 个 auth 命令**     | `login` / `status` / `logout` / `register`(通过 `provides.namespaces.auth` 自动注入到 `<bin> auth <cmd>`) |
| **login 三分支**       | 默认阻塞轮询(人类)/ `--no-wait --json`(发起,立即返回)/ `--device-code <code>`(完成轮询)                   |
| **register 命令**      | 用注册令牌 + client_metadata 换独立 client(RFC 7591 snake_case 响应),写 `~/.rxcli/config.json`             |
| **beforeCommand 钩子** | 跑 provider chain 取 token → 填 `ctx.credentials` / `ctx.state.user`                                      |
| **beforeRequest 钩子** | 按 `authStyle` 注入 header(bearer/x-api-key/basic)                                                        |
| **on401 续期 hook**    | `_transportConfig.on401`(singleflight refresh + 落盘 + 重跑 request hooks 后重试一次)                     |
| **精确豁免**           | `auth login/register` 等自动跳过自身 `beforeCommand`(不会被"必须登录"拦截)                                |
| **多 flow 支持**       | `flow` 选项:device(默认)/ authorization_code+PKCE / client_credentials                                    |
| **动态 scope**         | `scopeFromMetadata: true` → 运行时从 `/.well-known/oauth-authorization-server` 读 scopes_supported         |
| **sandbox 注入**       | `bearerToken` 一行注入预签发 JWT(priority 2,允许 --api-key 覆盖)                                          |

### defineAuth 全部选项

```ts
const auth = await defineAuth({
  credentialNamespace: "crm",           // 必填:凭证隔离命名空间
  baseUrl: AUTH_BASE_URL,               // 必填:auth-proxy 地址
  scope: "orders:read offline_access",  // 可选:OAuth scope(写死)
  scopeFromMetadata: true,              // 可选:动态从 metadata 读 scope(覆盖 scope)
  flow: "device",                       // 可选:device(默认)/ authorization_code / client_credentials
  clientMetadata: {                     // 可选:RFC 7591 注册时声明
    client_name: "crm",
    redirect_uris: ["http://localhost:8080/callback"],  // authCode flow 需要
  },
  bearerToken: process.env.CRM_BEARER_TOKEN, // 可选:sandbox/CI 一行注入 JWT
  providers: [...],                     // 可选:自定义 provider chain(不传=defaultProviders)
  clientId: "...",                      // 可选:env/config 回退
  clientSecret: "...",                  // 可选
  authStyle: "bearer",                  // 可选:bearer(默认)/ x-api-key / basic
  redirectPort: 8080,                   // 可选:authCode flow 本地回调端口
  store: memoryStore(),                 // 可选:测试注入
  commandNamespace: "auth",             // 可选:命令命名空间(默认 auth)
});
```

### 最小用法(必须 await,常见错误)

`defineAuth` 是 `async` 函数,返回 `Promise<Plugin>`,必须 `await`:

```ts
import { defineCli, defineAuth } from "@renxqoo/agent-data-cli";

// 正确:await 拿到的是 Plugin
const auth = await defineAuth({
  credentialNamespace: "rxweather",
  baseUrl: process.env.AUTH_BASE_URL!,
  scopeFromMetadata: true,          // 动态从 metadata 读 scope(不写死)
  clientMetadata: { client_name: "rxweather" },
  bearerToken: process.env.RXWEATHER_BEARER_TOKEN, // sandbox/CI 注入(可选)
});

defineCli({
  name: "rxweather",
  plugins: [auth],
  // ...
});
```

```ts
// 错误:缺 await → auth 是 Promise → plugins:[Promise] → beforeCommand 不执行,鉴权失效,且无报错
const auth = defineAuth({ ... })
defineCli({ plugins: [auth], ... })
```

> 此为鉴权场景最常见 bug。所有 `defineAuth` 示例均 `await`。若将 auth 工厂拆到单独 `src/auth.ts` 导出,该处也必须 `await` 后再 `export`(不能 `export const auth = defineAuth(...)`)。

### 首次使用顺序

```
register(注册令牌 + client_metadata → client_id/client_secret,写 ~/.rxcli/config.json)
   ↓
login(OAuth device flow → token,写 ~/.rxcli/credentials/<ns>.json)
   ↓
业务命令(orders list / ...)
```

跳过 register 直接 login → `device_authorization failed`(401 invalid_client)。

> **register 的 client_metadata**:RFC 7591 标准。`defineAuth({ clientMetadata: { client_name: "crm" } })` 声明后,register 命令会把它发给服务端。服务端返回 snake_case 响应(`client_id`/`client_secret`/`client_id_issued_at`/`client_secret_expires_at=0`)。

### clientId / Secret 的回填优先级

`defineAuth` 不传 `clientId/clientSecret` 时:

1. `process.env.RXCLI_CLIENT_ID` / `RXCLI_CLIENT_SECRET`(CI/临时覆盖)
2. `~/.rxcli/config.json`(register 写入,持久化)
3. 空(向后兼容未注册态,login 会失败提示 register)

---

## 1. agent 登录必须用 split-flow

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

---

## 2. install 向导(4 步,分发 CLI 用)

框架自带 install 向导,把"装包 → 装 skills → register → login"串成一键流程。业务包入口拦截 `argv[0]==='install'` 转给它:

```ts
// src/index.ts(bin 入口)。npm 全局安装时 argv[1] 是 bin 软链,用 realpathSync 比对入口。
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

## 3. 凭证存储路径(隔离多 CLI)

`defineAuth` 默认所有 CLI 共用 `~/.rxcli/`,无自动隔离。凭证靠 `credentialNamespace` 区分(`<dir>/credentials/<ns>.json`)。若两个 CLI 的 namespace 撞了 → **静默共用同一份凭证**,引发鉴权混乱。

**(a) 默认共享 `~/.rxcli`,靠 namespace 区分**(适合同一家公司的多个 CLI,token 可复用):

```ts
const auth = await defineAuth({
  credentialNamespace: "crm", // → ~/.rxcli/credentials/crm.json
  baseUrl: AUTH_BASE_URL,
});
```

**(b) 完全独立目录**(适合独立产品):

```ts
import { fileStore } from "@renxqoo/agent-data-cli";
import { join } from "node:path";
import { homedir } from "node:os";

const store = fileStore({ dir: join(homedir(), ".my-cli") }); // → ~/.my-cli/credentials/<ns>.json
const auth = await defineAuth({
  credentialNamespace: "my-cli",
  baseUrl: AUTH_BASE_URL,
  store, // 注入自定义 store 覆盖默认 ~/.rxcli
});
```

> `store` 选项在源码里标注"测试用",但它是唯一覆盖默认目录的方式,生产可用。测试用 `memoryStore({ credentials: { 'my-cli': { apiKey: 'sk_test' } } })`(不碰磁盘)。

---

## 何时不用 defineAuth(改用手写 Plugin)

| 场景                                          | 用什么                                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| 标准 OAuth(OAuth 中间层 + device flow)        | `defineAuth` 工厂(本文档)                                       |
| Bearer / API key / Basic(单 token,无 refresh) | `defineAuth({ authStyle: 'x-api-key' \| 'bearer' \| 'basic' })` |
| HMAC 签名(非 header 注入,要算签名)            | 手写 auth Plugin,见 `references/custom-auth-plugin.md`           |
| mTLS(客户端证书)                              | 手写 auth Plugin + `beforeRequest` 注入证书,见同文件             |
| 复合鉴权(签名 + header)                       | 手写 auth Plugin + 签名 Plugin(`enforce:'post'`),见同文件        |

后三类读 `references/custom-auth-plugin.md`(手写 Plugin 骨架、provider chain、HMAC 例子、provider 接口)。
