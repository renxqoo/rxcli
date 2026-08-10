# 插件进阶：钩子选择、enforce 顺序、自定义插件（中文）

> 鉴权只是插件的一个用途(最常见)。其他横切关注点(签名 / 审计 / 错误归一化 / 字段脱敏 / 固定参数)都用插件实现。

## 导航

1. 钩子与执行顺序
2. 常用插件模式
3. 插件提供命令与独立发布
4. 安全调试与常见错误

## 1. 5 个钩子 + 何时用

| 钩子            | 何时触发               | 能改什么                                      | 典型用途                            |
| --------------- | ---------------------- | --------------------------------------------- | ----------------------------------- |
| `beforeCommand` | 命令 run 前(填 state)  | `ctx.state`、可 throw 中止                    | auth 填 user、参数预处理            |
| `beforeRequest` | 每次 `ctx.get/post` 前 | `req`(method/path/query/body/headers/timeout) | 加 header、HMAC 签名、注入 tenantId |
| `afterRequest`  | 每次请求返回后         | `res` 只读,主要用于副作用                     | 审计、metric、请求日志              |
| `beforeOutput`  | run 返回后、序列化前   | 返回新 `data`(StructuredData)                 | 脱敏、删内部字段、改字段名          |
| `onError`       | 任何钩子或 run 抛错时  | 返回新 error / 透传 / undefined               | 错误归一化、脱敏、重试              |

---

## 2. enforce 三档:解决钩子执行顺序

```
pre 插件(注册序)    ← 基础设置(加基础 header、auth 注入 token)
  ↓
normal 插件(注册序) ← 业务相关
  ↓
post 插件(注册序)   ← 最终包装(HMAC 签名、收尾)
  ↓
(真正执行:发请求 / 序列化输出)
```

`enforce` 支持 `"pre"`、`"normal"`、`"post"`。省略时等价于 `"normal"`；通常省略即可。

> ```ts
> {
>   name: "tenant"; /* 省略 enforce = normal */
> }
> ```

**典型配对**:

- auth Plugin `enforce:'pre'` —— 先填 token
- tenant Plugin `enforce:'pre'` —— 加固定 query(在 token 注入后、其他所有修改前)
- HMAC 签名 Plugin `enforce:'post'` —— 等所有 header/body 定型再算签名

```ts
defineCli({
  plugins: [
    auth, // enforce:'pre'(auth Plugin 内部声明)
    {
      name: "tenant",
      enforce: "pre",
      async beforeRequest(ctx, req) {
        req.query = { ...req.query, tenantId: "acme" };
      },
    },
    {
      name: "hmac-sign",
      enforce: "post",
      async beforeRequest(ctx, req) {
        req.headers["X-Sig"] = sign(req.body, ctx.state.secretKey);
      },
    },
  ],
});
```

---

## 3. 4 个常见自定义插件

### 3.1 固定 header 注入

```ts
const headerPlugin = {
  name: "fixed-headers",
  enforce: "pre" as const,
  async beforeRequest(ctx, req) {
    req.headers = { ...req.headers, "X-Client": "my-cli", "X-Version": "1.0.0" };
  },
};
```

### 3.2 审计 / metric

```ts
const auditPlugin = {
  name: "audit",
  async afterRequest(ctx, res) {
    if (res.status >= 400) {
      // 上报 / 写日志(走 stderr,不污染 stdout)
      ctx.log.warn(`request failed: status=${res.status}`);
    }
  },
};
```

### 3.3 字段脱敏(beforeOutput)

```ts
const redactPlugin = {
  name: "redact",
  enforce: "post" as const,
  async beforeOutput(ctx, data) {
    if (Array.isArray(data)) return data.map(redactItem);
    if (data && typeof data === "object") return redactItem(data);
    return data;
  },
};
function redactItem(item: Record<string, unknown>) {
  const out = { ...item };
  if ("email" in out) out.email = maskEmail(String(out.email));
  if ("phone" in out) out.phone = maskPhone(String(out.phone));
  return out;
}
```

**`beforeOutput` 必须返回 StructuredData**(object/array/null),**不能返回 string**——否则破坏管道契约。

### 3.4 错误归一化(onError)

```ts
import { errs } from "@renxqoo/agent-data-cli";

const errorNormalizePlugin = {
  name: "error-normalize",
  async onError(ctx, err) {
    if (!(err instanceof errs.CliError)) return err;

    // 脱敏:防止 token 漏到 message
    if (err.message) {
      err.message = err.message.replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
    }
    // 网络错误补 hint
    if (err instanceof errs.NetworkError && !err.hint) {
      err.hint = "检查网络连接,或稍后重试";
    }
    return err;
  },
};
```

**onError 是链式的**:每个插件都跑一遍,返回值传给下一个。某个 `onError` 自己抛错时，框架把该异常作为当前错误并继续后续 hook，保证审计/脱敏插件不会被跳过。返回 `undefined` = **吞掉错误**(命令变成功)——这是危险操作,慎用。

---

## 4. 插件提供命令(provides)

插件可以**贡献命令**,defineCli 自动注入到 namespace:

```ts
const myPlugin = {
  name: "audit",
  provides: {
    namespaces: {
      audit: {
        // → my-cli audit list
        list: defineCommand({
          name: "list",
          description: "查看最近审计日志",
          async run() {
            /* ... */
          },
        }),
      },
    },
  },
  async beforeCommand(ctx) {
    /* ... */
  },
};
```

**精确豁免**:plugin 自己贡献的命令**跳该 plugin 自身的 beforeCommand**,但**不跳别的 plugin**。ownership 由每个 App 在装配期独立计算，不会修改 plugin 对象；同一个 frozen plugin 或带私有字段的 class plugin 可安全复用于多个 App。业务显式覆盖同 route 后，该命令不再被视为 plugin 自有命令。

---

## 5. 插件发布:独立 npm

横切插件可独立发 npm,多个业务包复用:

```ts
// @my-org/rxcli-plugin-tenant(独立包)
export const tenantPlugin = (tenantId: string): Plugin => ({
  name: "tenant",
  enforce: "pre",
  async beforeRequest(ctx, req) {
    req.query = { ...req.query, tenantId };
  },
});
```

```ts
// 任意业务包用它
import { tenantPlugin } from '@my-org/rxcli-plugin-tenant'
defineCli({ plugins: [tenantPlugin('acme')], ... })
```

---

## 6. 调试:看请求链路

框架不内置 `--verbose`。需要调试时用环境变量控制插件，并且只记录请求方法、路径、状态和 request ID；不要记录认证 header、query/body 或完整响应。

```ts
const debugPlugin = {
  name: "debug",
  enforce: "pre" as const,
  async beforeRequest(ctx, req) {
    if (process.env.MYCLI_DEBUG) {
      ctx.log.info(`→ ${req.method} ${req.path}`);
    }
  },
  async afterRequest(ctx, res) {
    if (process.env.MYCLI_DEBUG) {
      ctx.log.info(`← ${res.status}`);
    }
  },
};
```

---

## 7. 插件常见错

1. **enforce 选错** —— HMAC 签名插件用了 `pre` 档,签名算出来 header 还没全,签名错了。改 `post`。
2. **依赖注册顺序却没测试** —— 同一 `enforce` 档按注册顺序执行；为有先后依赖的插件写生命周期测试。
3. **`beforeOutput` 返回 string** —— TS 编译会拦(StructuredData 类型排除 string),但运行时报错更糟。
4. **onError 返回 undefined** —— 错误被吞掉,exit 0,agent 误以为成功。**只有"这是正常分支"才用**。
5. **plugin 之间共享 state 字段没声明** —— `defineCli<State>` 没声明,ctx.state.X = Y 编译报错。
6. **`_ownedRoutes` 手写** —— 业务开发者**不写**；route ownership 是框架的 App-local 内部状态。
7. **调试日志输出请求或响应体** —— 可能泄露 token 和业务数据；只记录最小元数据并脱敏。
