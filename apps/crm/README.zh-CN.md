# @renxqoo/cli (rxcli)

> agent 访问公司业务数据的命令行工具 —— 订单 / 商品 / 发票 / 账号。
>
> 基于 [`@renxqoo/agent-data-cli`](../cli-sdk/README.zh-CN.md) 框架,演示如何用 SDK 搭建一个 agent-native 业务包。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

[English](README.md) · [中文](README.zh-CN.md)

---

## 这是什么

`rxcli` 是一个连接鉴权中间层、访问公司业务系统(订单/商品/发票/账号)的命令行工具。它既是终端用户日常查数据的工具,也是 AI agent 自动化获取业务数据的接口。

```
agent / 终端用户
    │  rxcli orders list
    ▼
@renxqoo/cli (本包,业务命令)
    │  经 OAuth 鉴权 + 统一输出格式封装
    ▼
鉴权中间层 (验 JWT、换 company_token)
    │
    ▼
公司业务系统 (订单/商品/发票/账号 API)
```

**特性:**

- 🔐 **OAuth device flow 登录** —— 浏览器扫码授权,token 自动刷新
- 📦 **结构化输出** —— 默认 JSON 统一输出(agent 友好);`--no-json` 切人类可读表格
- 🚇 **unix 管道** —— `rxcli orders list | jq '...'` 自由组合
- 📖 **skill 自服务** —— AI agent 读 SKILL.md 自动学会所有命令
- 🧙 **install 向导** —— `rxcli install` 一键引导(全局安装 + skills + 注册 + 登录)

---

## 快速开始

### 一键安装(推荐)

```bash
npx @renxqoo/cli install
```

自动完成三步:① 全局安装 CLI → ② 安装 Skill 到你的 AI 工具发现目录(`~/.agents` 始终写 + 已装工具 `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi` 自动探测)→ ③ 注册 + 登录。需 Node ≥ 20。

> `npx` 无需预装,跑完即得全局 `rxcli` 命令 + 已就位的 skill。

### 手动安装(分步,等价于一键安装)

如果一键安装某步失败或想单独执行:

**第 1 步:安装 CLI**

```bash
npm install -g @renxqoo/cli
```

安装后跑 `rxcli --help` 确认可用。不想全局装?用 `npx @renxqoo/cli <命令>` 临时执行。

**第 2 步:安装 Skill(让 AI 工具发现)**

把 skill 同步到你的 AI 工具发现目录(`~/.agents` 始终写 + 已装工具如 `~/.claude`/`~/.cursor`/`~/.zcode` 自动探测——覆盖 Claude Code / Cursor / Codex / ZCode / OpenClaw / Pi / Trae):

```bash
rxcli skills sync
```

同步后 AI 工具即可在用户提到订单、商品、发票、账号等关键词时自动触发本 skill。验证:

```bash
rxcli skills list            # 列出已装的 skill
ls ~/.agents/skills/         # 确认 skill 文件就位
```

**第 3 步:配置凭证(OAuth 鉴权)**

首次使用需注册 + 登录(OAuth device flow):

```bash
rxcli auth register --token <注册令牌>   # 首次注册(令牌从管理员获取)
rxcli auth login                          # 浏览器扫码授权
```

验证:`rxcli auth status` 显示已登录。

---

## 命令一览

### 业务命令

```bash
# 订单
rxcli orders list [--limit N]          # 查询订单列表(仅本人)
rxcli orders get <id>                  # 查询单个订单详情

# 商品
rxcli products list [--category 分类]  # 查询商品列表
rxcli products get <id>                # 查询商品详情(价格/库存)

# 发票
rxcli invoices list                    # 查询发票列表(仅本人)

# 账号
rxcli account profile                  # 查看当前登录用户资料
rxcli account admin-users              # 管理员:查全量用户列表
```

### 鉴权命令

```bash
rxcli auth register [--token <注册令牌>]  # 注册本机 client(一次性)
rxcli auth login                          # 登录(OAuth device flow)
rxcli auth status                         # 查看登录状态
rxcli auth logout                         # 退出登录
```

### 工具命令

```bash
rxcli qrcode <url>              # 把 URL 生成二维码(ASCII / PNG)
rxcli skills list               # 列出所有 skill
rxcli skills read <name>        # 读 skill 文档
rxcli skills sync               # 同步 skills 到所有 agent 发现目录
rxcli skills gen <name>         # 生成/刷新命令文档
```

### 全局选项

```bash
--json          强制 JSON 统一输出
--no-json       强制人类可读文本输出(终端用)
-h, --help      查看帮助
-v, --version   查看版本
```

---

## 使用示例

### 终端查数据(人类可读)

```bash
$ rxcli orders list --no-json
id      userId   status   total  currency
------  -------  -------  -----  --------
o_1001  u_alice  paid       199  CNY
o_1002  u_alice  shipped   58.5  CNY
```

### agent 获取数据(JSON)

```bash
$ rxcli orders list
{"ok":true,"identity":"user","data":{"orders":[{"id":"o_1001","status":"paid","total":199},...]}}
```

### 管道组合

```bash
# 查已支付订单的总额
rxcli orders list | jq '[.data.orders[] | select(.status=="paid") | .total] | add'

# 管道保护:被管道时即使 --no-json 也强制 JSON
rxcli orders list --no-json | jq '.data'
```

### AI agent 集成

AI agent 读各自发现目录(如 `~/.agents/skills/`、`~/.claude/skills/`、`~/.codex/skills/`)下的 SKILL.md,自动学会所有命令:

```
用户:帮我查下最近的订单
agent: (读 rx-orders skill) → rxcli orders list → 解析统一输出格式 → 返回结果
```

---

## 输出格式

`rxcli` 默认按"是否终端"自动选择:

| 场景         | 默认输出               |
| ------------ | ---------------------- |
| 终端(TTY)    | 人类可读文本(自动表格) |
| 管道/脚本/CI | JSON 统一输出              |

显式控制:`--json`(强制 JSON)/ `--no-json`(强制文本)。

---

## 配置

### 环境变量

| 变量                  | 默认                    | 说明                               |
| --------------------- | ----------------------- | ---------------------------------- |
| `RXCLI_AUTH_BASE_URL` | `http://localhost:3000` | 鉴权中间层地址                     |
| `RXCLI_API_BASE_URL`  | `http://localhost:3000` | 业务 API 网关地址                  |
| `RXCLI_CLIENT_ID`     | (config.json)           | OAuth client id                    |
| `RXCLI_CLIENT_SECRET` | (config.json)           | OAuth client secret                |
| `RXCLI_SKILLS_SOURCE` | (空=本地)               | skills 源 URL(空用包内本地 skills) |

### 本地文件

```
~/.rxcli/
├── config.json              clientId / clientSecret(register 写入)
└── credentials/
    └── crm.json             OAuth token(login 写入,0600 权限)
```

---

## 测试

rxcli 依赖 OAuth 鉴权中间层(device flow 授权 + JWT 签发 + 业务 API 网关)。测试或开发前,需先部署配套的 [**renxqoo/auth-proxy**](https://github.com/renxqoo/auth-proxy):

```bash
git clone https://github.com/renxqoo/auth-proxy.git
cd auth-proxy

# 1. 启动依赖(Postgres + Redis)
docker compose up -d postgres redis

# 2. 跑数据库迁移 + 初始化种子(生成 RSA 密钥 + 首个管理员)
DATABASE_URL=postgres://localhost:5432/auth-proxy pnpm --filter @auth-proxy/db migrate
DATABASE_URL=postgres://localhost:5432/auth-proxy \
  ADMIN_USERNAME=admin ADMIN_PASSWORD=devpassword123 \
  pnpm --filter @auth-proxy/db seed

# 3. 启动服务(mock 公司应用 + 鉴权中间层)
pnpm dev:all
```

启动后 auth-proxy 默认监听 `localhost:3000`(含 OAuth device flow + 业务 API 网关 + mock 公司应用)。rxcli 的默认配置(`RXCLI_AUTH_BASE_URL` / `RXCLI_API_BASE_URL` 均为 `http://localhost:3000`)直接对接,无需额外配置。

然后在管理后台(`localhost:3001/admin`,用 seed 设置的账号登录)创建 client 并获取注册令牌,即可跑 rxcli 的注册 → 登录 → 查数据流程:

```bash
rxcli auth register --token <注册令牌>   # 注册本机 client
rxcli auth login                          # 浏览器扫码授权
rxcli orders list                         # 查询订单(走 auth-proxy → mock 公司应用)
```

> auth-proxy 的部署细节(Docker 生产部署、环境变量、架构)见其 [README](https://github.com/renxqoo/auth-proxy)。

---

## 开发

本包是 [rxcli monorepo](https://github.com/renxqoo/rxcli) 的业务应用,依赖 `@renxqoo/agent-data-cli` 框架。

```bash
# 在 monorepo 根目录
pnpm install
pnpm build          # 构建所有包(改了 cli-sdk 源码必须先 build)
pnpm test           # 跑测试

# 仅本包
cd apps/crm
pnpm typecheck
pnpm test
pnpm build
```

> **注意**:`crm` 解析 `@renxqoo/agent-data-cli` 的 **dist**(不是源码)。改了 cli-sdk 源码后,必须先 `pnpm build`(在 packages/cli-sdk),crm 才能看到变化。

### 业务包入口(参考实现)

```ts
import { defineCli, defineAuth } from "@renxqoo/agent-data-cli";

const auth = await defineAuth({
  credentialNamespace: "crm",
  baseUrl: AUTH_BASE_URL,
  scope: "company.api offline_access",
});

export default defineCli({
  name: "crm",
  plugins: [auth], // 钩子 + auth 命令全自动
  commands: {},
  namespaces: { orders, products, invoices, account }, // 纯业务
  baseUrl: API_BASE_URL,
  errorOnStatus: {
    401: "token_expired",
    403: "forbidden",
    404: "not_found",
    "5xx": "server_error",
  },
});
```

---

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
