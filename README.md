# rxcli

通过鉴权中间层(auth-proxy)访问公司应用接口的 CLI 工具,为人类和 AI Agent 设计。

CLI 不直接持有公司应用凭证,而是经 OAuth 2.0 设备授权流程在中间层登录,再由中间层代理所有业务请求 —— company_token 永不离开中间层。

[安装](#安装) · [快速开始](#快速开始) · [Agent Skills](#agent-skills) · [命令](#命令) · [认证](#认证) · [多环境](#多环境)

## 特性

- **Agent-Native** — 内置 AI Agent Skills,兼容主流 AI 工具(ZCode / Claude Code / Codex),Agent 零配置即可操作;结构化信封(stdout=数据 / stderr=错误),管道可靠组合
- **安全边界** — 账号密码只在浏览器↔中间层,CLI 不接触;company_token 只存中间层,CLI 只持有中间层签发的 JWT
- **动态注册** — 每台机器独立 client 凭据,无需硬编码 secret;注册令牌由管理员后台管理(一次性/多次可选)
- **多环境** — dev / test / prod,环境变量切换
- **自动续期** — token 过期自动刷新(singleflight 复用,避免并发重复刷新)

## 架构

```
CLI ──device flow──► 中间层(auth-proxy)──账号密码──► 公司应用
CLI ──/proxy/*────► 中间层 gateway ──company_token──► 公司应用
```

- CLI 本地只持有:中间层签发的 JWT(含 sessionId)
- company_token 全程在中间层(PG),不离开中间层
- JWT 用 RS256 签名,私钥只在中间层

## 安装

### 前置要求

- Node.js 18+

### 全局安装(推荐)

```bash
npm install -g @renxqoo/cli
```

安装后 `rxcli` 命令全局可用。

### npx 即用即跑(不污染全局)

```bash
npx @renxqoo/cli@latest <命令>
```

> 首次运行会有几秒下载时间。下文示例统一用 `rxcli` 简写,npx 用户替换成 `npx @renxqoo/cli`。

### 一键安装向导

向导自动完成:装 AI Skills → 注册 → 登录。

```bash
rxcli install          # 全局安装后
# 或
npx @renxqoo/cli@latest install
```

> 在终端交互运行;非交互环境(如 CI)会跳过注册/登录步骤并提示手动命令。

## 快速开始(人类用户)

> **AI Agent 注意**:如果你是帮用户操作的 AI Agent,跳到 [快速开始(AI Agent)](#快速开始ai-agent)。

### 1. 注册本机客户端

每台机器首次使用需注册(获取独立 client 凭据)。需要**注册令牌**(从管理员后台获取):

```bash
rxcli auth register --token <注册令牌>
```

注册成功后凭据写入 `~/.rxcli/config.json`,之后无需重复。

### 2. 登录

```bash
rxcli auth login
```

CLI 会打印验证 URL,在浏览器打开并输入公司账号密码(如 alice/alice123),CLI 自动完成登录。

### 3. 使用

```bash
rxcli orders list          # 查询订单
rxcli products list        # 查询商品目录
rxcli account profile      # 查看个人资料
rxcli auth status          # 查看登录状态
```

终端默认输出人类可读表格;被管道/脚本调用时自动切 JSON 信封(agent 友好)。显式控制:`--no-json`(强制文本)/ `--json`(强制 JSON)。

## 快速开始(AI Agent)

> 以下步骤供 AI Agent 使用。部分步骤需要用户在浏览器完成。

**Step 1 — 注册本机客户端**

需要注册令牌(从管理员获取)。运行后交互输入令牌:

```bash
rxcli auth register
```

或直接传令牌:

```bash
rxcli auth register --token <注册令牌>
```

**Step 2 — 登录**

> 此命令会输出验证 URL —— 提取 URL 原样发给用户,不要修改。用户在浏览器完成登录后命令自动结束。

```bash
rxcli auth login
```

**URL 输出规则**:验证 URL 是 opaque string,不要做任何修改(包括 URL 编码/解码、添加空格或标点、重新拼接 query)。

**Step 3 — 验证登录态**

```bash
rxcli auth status
```

**Step 4 — 调用接口**

```bash
rxcli orders list
```

输出是结构化 JSON 信封 `{"ok":true,"data":...}`,可直接解析。错误信封走 stderr,exit code 分类(2 参数错 / 3 需登录 / 6 API 错 等)。

## Agent Skills

CLI 内置 AI Agent Skills(SKILL.md 指令文档),教 Agent 何时、如何使用命令。两种发现方式:

```bash
# 方式一:命令发现(agent 执行,无需安装)
rxcli skills list                    # 列出所有 skill(JSON)
rxcli skills read rx-orders          # 读 skill 内容(Markdown)

# 方式二:安装到 agent 扫描目录(推荐)
rxcli install                        # 一键装到 30+ AI 工具(Claude Code / Cursor / Codex 等)
rxcli skills sync                    # 仅本地兜底:拷贝到 ~/.agents/skills/
```

`install` 通过 skills.sh 把 skill 写入各 AI 工具的标准发现路径(universal + symlinked);`sync` 只写 `~/.agents/skills/`,适合离线或 install 不可达时兜底。装好后,Agent 启动时按 description 语义匹配用户意图。

| Skill             | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `rx-shared`       | 注册、登录、认证、错误处理(所有其它 skill 的前置,必读)       |
| `rx-auth`         | 登录、查看状态、登出                                           |
| `rx-orders`       | 查询订单列表 / 订单详情                                        |
| `rx-products`     | 查询商品目录(列表 / 按分类过滤 / 详情)                       |
| `rx-invoices`     | 查询发票列表                                                   |
| `rx-account`      | 查看个人资料 / 管理员查全量用户                                |

## 命令

| 命令                              | 说明                                     |
| --------------------------------- | ---------------------------------------- |
| `auth register [--token <t>]`     | 注册本机客户端(用注册令牌换独立凭据)   |
| `auth login`                      | 经中间层登录(设备流程,浏览器输公司账号)|
| `auth status`                     | 查看登录状态                             |
| `auth logout`                     | 退出登录(吊销 session + 清本地凭证)    |
| `orders list [--limit n]`         | 查询订单列表(仅本人订单)               |
| `orders get <id>`                 | 查询订单详情(仅本人订单可见)           |
| `products list [--category <c>]`  | 查询商品列表,可按分类过滤               |
| `products get <id>`               | 查询商品详情                             |
| `invoices list`                   | 查询发票列表(仅本人发票)               |
| `account profile`                 | 查看当前用户资料                         |
| `account admin-users`             | 管理员:全量用户列表                     |
| `qrcode <url>`                    | 把 URL 生成二维码(终端 ASCII 或 PNG)   |
| `skills list [name]`              | 列出 skill 或列举目录                    |
| `skills read <name>[/path]`       | 读 skill 内容                            |
| `skills sync`                     | 同步 skill 到 ~/.agents/skills/          |

## 认证

| 命令           | 说明                                       |
| -------------- | ------------------------------------------ |
| `auth login`   | OAuth 设备流程登录,浏览器输公司账号密码   |
| `auth status`  | 显示当前登录用户、token 状态               |
| `auth logout`  | 吊销当前 session(服务端 + 本地)          |

登录流程:
1. `auth login` 打印验证 URL
2. 用户浏览器打开 URL,输入公司账号密码
3. 中间层代调公司应用登录,拿 company_token 存 PG
4. 中间层签发 JWT(RS256)给 CLI,存入 `~/.rxcli/credentials/crm.json`

token 生命周期:
- access token(1h)过期 → CLI 自动用 refresh token 续期(singleflight 复用,并发 401 只刷新一次)
- refresh token(7d)过期 → 需重新 `auth login`
- refresh token 重用检测 → 自动吊销 session(安全加固)

## 多环境

用环境变量配置中间层地址(默认本地开发):

```bash
RXCLI_AUTH_BASE_URL=https://auth.example.com  \
RXCLI_API_BASE_URL=https://gateway.example.com  \
rxcli auth login
```

| 环境变量              | 默认                    | 说明                          |
| --------------------- | ----------------------- | ----------------------------- |
| `RXCLI_AUTH_BASE_URL` | `http://localhost:3000` | 鉴权中间层(device flow/token)|
| `RXCLI_API_BASE_URL`  | `http://localhost:3000` | 业务 API 网关(/proxy/*)      |
| `RXCLI_CLIENT_ID`     | (config.json)           | OAuth client id               |
| `RXCLI_CLIENT_SECRET` | (config.json)           | OAuth client secret           |
| `RXCLI_SKILLS_SOURCE` | (空=本地 skills)        | skills 源 URL(install 向导用)|

## 本地存储

| 文件                              | 内容                          | 权限  |
| --------------------------------- | ----------------------------- | ----- |
| `~/.rxcli/config.json`            | client 凭据(clientId/secret) | 0600  |
| `~/.rxcli/credentials/crm.json`   | JWT + refresh token           | 0600  |

## 输出格式

默认按"是否终端"自动选择,业务包可在 `defineCli({ defaultFormat })` 改默认:

| 场景 | 默认输出 |
|---|---|
| 终端(TTY) | 人类可读文本(自动表格,CJK 对齐) |
| 管道/脚本/CI | JSON 信封 `{"ok":true,"data":...}` |

显式控制:`--json`(强制 JSON)/ `--no-json`(强制文本,管道保护:被管道时仍 JSON)。命令可选声明 `humanFormat` 精致化(¥/中文列名)。

## 安全

- **账号密码**:只在浏览器↔中间层 `/verify`,CLI 不接触
- **company_token**:只存中间层 PG,不进 JWT,不离开中间层
- **JWT**:RS256 签名,私钥只在中间层;CLI 只持 sessionId
- **client_secret**:scrypt hash 存储,不明文
- **CSRF**:登录页双重提交 cookie
- **限流**:/token 按 client、/proxy 按 session、/verify 按 IP
- **吊销**:`auth logout` 吊销 session;管理员可"踢下线"(吊销某 client 所有 session)

## 开发

本仓是 monorepo(pnpm workspace),包含 `@renxqoo/cli` 业务包。

```bash
pnpm install            # 装依赖
pnpm build              # 构建所有包
pnpm typecheck          # 类型检查
pnpm test               # 跑测试(vitest)
```

### 添加新 Skill

1. 在 `apps/crm/skills/` 下建目录(如 `rx-orders/`)
2. 写 `SKILL.md`(含 frontmatter + 命令映射)
3. 可选:加 `references/` 深度文档
4. `pnpm build` + `rxcli skills sync`(或 `rxcli skills gen <name>` 自动生成命令文档)

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
