# SKILL.md 完整模板 + 自动生成机制

> SKILL.md 是给 AI agent 读的指令文档,决定 agent 何时触发你的 CLI。cli-sdk 用"机械信息自动生成 + 语义信息人写 + 标记块隔离"机制,保证两边永不漂移。

---

## 1. 两种信息,两种产出

| 信息类型     | 例子                                             | 谁产出                        |
| ------------ | ------------------------------------------------ | ----------------------------- |
| **机械信息** | 命令签名、参数列表、类型、必填、默认值           | `defineCommands` **自动生成** |
| **语义信息** | description、"用户说X用什么"、前置条件、错误处理 | 人写                          |

加一个参数要同步改 SKILL.md 和代码 → 必然漂移。机械信息从代码生成,保证永远同步。

---

## 2. skill 命令一览(自动注入)

业务包加 `skillsDir: './skills'` 后,自动有这些命令:

| 命令                                          | 干什么                                              |
| --------------------------------------------- | --------------------------------------------------- |
| `my-cli skills list`                          | 列出所有 skill(返回信封)                            |
| `my-cli skills read <name>`                   | 读 SKILL.md 原文(stdout,**信封契约例外**)           |
| `my-cli skills read <name>/references/foo.md` | 读 reference 文件(带路径穿越校验)                   |
| `my-cli skills sync`                          | 同步到 `~/.agents/skills/`(主流 agent 工具发现路径) |
| `my-cli skills gen <name>`                    | 刷新已有 SKILL.md 的命令表(AUTO-GEN 块内)           |
| `my-cli skills gen <name> --init`             | 首次生成整份 SKILL.md 骨架(带 `{{FILL}}` 占位)      |

---

## 3. 完整 SKILL.md 模板

````markdown
---
name: rx-todos
version: 1.0.0
description: 查询和管理待办。当用户需要查待办、看待办列表、标记待办完成、新建待办时使用。
metadata:
  requires:
    bins: ["my-cli"]
  cliHelp: "my-cli --help"
  category: business
---

# todos

通过 CLI 查询后端待办服务,支持列表查询、详情、创建、标记完成。

**CRITICAL — 调用前 MUST 检查登录状态**:读 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md)(如适用)。

<!-- AUTO-GEN:START commands -->
<!-- 本区块由 `my-cli skills gen` 自动生成,不要手改 -->

## 命令

| 操作         | 命令                                   |
| ------------ | -------------------------------------- |
| 查询待办列表 | `my-cli todos list [--limit <number>]` |
| 查询待办详情 | `my-cli todos get <id>`                |
| 标记待办完成 | `my-cli todos complete <id>`           |

### 参数说明

**list**

| 参数      | 类型   | 必填 | 默认 | 说明         |
| --------- | ------ | :--: | ---- | ------------ |
| `--limit` | number |  否  | 20   | 返回数量上限 |

**get**

| 参数   | 类型   | 必填 | 说明    |
| ------ | ------ | :--: | ------- |
| `<id>` | string |  是  | 待办 ID |

**complete**

| 参数   | 类型   | 必填 | 说明    |
| ------ | ------ | :--: | ------- |
| `<id>` | string |  是  | 待办 ID |

<!-- AUTO-GEN:END -->

## 何时用

| 用户说                                | 用什么                  |
| ------------------------------------- | ----------------------- |
| "查待办" / "看看待办" / "待办列表"    | `todos list`            |
| "最近 5 条待办"                       | `todos list --limit 5`  |
| "查一下 t_1001" / "这个待办详情"      | `todos get t_1001`      |
| "把 t_1001 标记完成" / "搞定这个待办" | `todos complete t_1001` |

## 前置条件

调用 todos 命令前,确保已登录:

- 检查:`my-cli auth status`
- 未登录 → 按下面 split-flow 登录

### 登录(AI agent 必须用 split-flow)

> {{FILL: 若业务无鉴权,删除本节}}

首次使用前,本机需先注册一次:`my-cli auth register --token <注册令牌>`(令牌从管理员获取)。之后:

**禁止直接跑 `my-cli auth login`(会阻塞数分钟,agent 拿不到 URL)**。用两步:

1. 发起(当前轮):`my-cli auth login --no-wait --json` → 记住返回的 `data.device_code` 和 `data.verification_url`
2. 生成二维码给用户:`my-cli qrcode <verification_url> --output /tmp/login-qr.png`,把 URL + 二维码给用户
3. 等用户回复"授权好了"后,完成(下一轮):`my-cli auth login --device-code <device_code>`

## todos list

查询待办列表(只返回**当前登录用户**的待办,跨用户隔离)。

```bash
my-cli todos list              # 查全部
my-cli todos list --limit 10   # 限制返回数量
```
````

### 输出示例

```json
{ "ok": true, "data": [{ "id": "t_1001", "title": "写周报", "done": false }] }
```

## todos get

查询单个待办详情。

```bash
my-cli todos get t_1001
```

## todos complete

把待办标记为完成。

```bash
my-cli todos complete t_1001
```

### 错误处理

| 错误                      | 处理                                 |
| ------------------------- | ------------------------------------ |
| `not_found` / exit 1      | 待办不存在,用 `todos list` 查有效 ID |
| exit 3 + `no_credentials` | 未登录,`my-cli auth login`           |
| exit 4 网络错误           | 稍后重试                             |

````

---

## 4. frontmatter 规范

```yaml
---
name: <skill 名,必填,与目录名一致>
description: <一句话描述何时用,必填,agent 靠它触发>
version: <semver,可选>
metadata:                       # 可选
  requires:
    bins: ["my-cli"]            # 依赖的 bin(让 agent 知道要先装)
  cliHelp: "my-cli --help"      # 提示用户跑这个看完整命令
  category: business            # 分类(business / devops / data / ...)
---
````

### description 写法(关键!)

✅ **好** —— 写清楚"何时用":

```
"查询和管理待办。当用户需要查待办、看待办列表、标记待办完成、新建待办时使用。"
```

❌ **坏** —— 太抽象,agent 难匹配:

```
"待办管理工具"
```

---

## 5. AUTO-GEN 标记块

```markdown
<!-- AUTO-GEN:START commands -->
<!-- 本区块由 `my-cli skills gen` 自动生成,不要手改 -->

... 自动生成的内容(命令表 + 参数说明) ...
<!-- AUTO-GEN:END -->
```

- **标记块内** = 自动生成,每次 `gen` 覆盖,**人不要手改**
- **标记块外** = 人写的语义内容(何时用 / 错误处理 / 前置条件),`gen` **永不触碰**

这意味着:

- 加命令 → `gen <name>` 重生成,语义部分不动
- 改语义 → 直接编辑 SKILL.md,不会被 gen 覆盖

---

## 6. 完整工作流

```bash
# 1. 写命令(defineCommands + 每个 args 都填 desc)
# src/commands/todos.ts 已定义好

# 2. 首次生成 SKILL.md 骨架
my-cli skills gen rx-todos --init
# → 生成 skills/rx-todos/SKILL.md,带 AUTO-GEN 块(已填)+ {{FILL}} 占位

# 3. 编辑 SKILL.md,填语义部分(何时用、错误处理、前置条件)
vi skills/rx-todos/SKILL.md

# 4. 后续命令有改动(加参数/改 scope),重新生成(只刷 AUTO-GEN 块)
my-cli skills gen rx-todos
# → 语义部分不动,机械部分更新

# 5. 可选:加深度文档
mkdir skills/rx-todos/references
vi skills/rx-todos/references/todos-list.md   # 手写,gen 不碰

# 6. 发布:skills/ 随包发布
# package.json 的 "files": ["dist", "skills"]
```

### skills 分发:skillsSource + install 向导

业务包配 `defineCli({ skillsSource: process.env.X_SKILLS_SOURCE })`,决定 install 向导怎么装 skills:

| `skillsSource`                         | install 向导行为                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 空(默认)                               | 跑 `my-cli skills sync`,把包内本地 `skills/` 写到 `~/.agents/skills/`(主流 agent 工具发现路径) |
| 设了 URL(如 `https://skills.sh/p/xxx`) | 优先 `npx skills add <url>`(覆盖 30+ AI 工具发现路径),失败回退本地 sync                        |

业务包入口拦截 `argv[0]==='install'` → `runInstallWizard({ skillsSource })`(4 步:npm i -g → 装 skills → register → login)。详见主 SKILL.md §8。

---

## 7. 深度文档(references/)

子目录 `references/` 放深度文档,agent 按需读:

```
skills/rx-todos/
├── SKILL.md                    入口
└── references/
    ├── todos-list.md           列表的完整参数、边界、性能
    ├── todos-get.md            详情的数据流、字段含义
    └── pagination.md           分页协议详解
```

SKILL.md 里用相对路径引用 + 提示怎么读:

```markdown
- 需要了解 todos list 的完整参数和边界?读 `references/todos-list.md`
  (用 `my-cli skills read rx-todos/references/todos-list.md`)
```

---

## 8. 签名生成规则

cli-sdk 生成的命令签名规则(对齐 commander/git/jq):

| 参数特征              | 签名写法             | 例子                  |
| --------------------- | -------------------- | --------------------- |
| required + positional | `<name>`             | `get <id>`            |
| optional + positional | `[<name>]`           | `[<offset>]`          |
| required + flag       | `--name <type>`      | `--status <string>`   |
| optional + flag       | `[--name <type>]`    | `[--limit <number>]`  |
| boolean flag          | `[--flag]`           | `[--json]`            |
| array flag(可多次)    | `[--name <type>...]` | `[--tag <string>...]` |

---

## 9. args 的 desc 字段(提升文档质量)

每个 arg 可选填 `desc`,**填了进文档,不填是 `—`**。强烈建议每个参数都填:

```ts
args: {
  limit:  { type: 'number', default: 30, desc: '返回数量上限(1-100)' },
  status: { type: 'string', desc: '状态: unpaid/paid/shipped/cancelled' },
  force:  { type: 'boolean', desc: '跳过确认' },
}
```

**desc 几乎零成本,文档质量大幅提升。**

---

## 10. 安全:路径穿越校验

`skills read <name>/<path>` 拒绝路径穿越:

- 拒绝绝对路径(`/etc/...` 和 Windows `C:\...`)
- 拒绝含 `..` 的路径(归一化后检查)
- 只允许相对路径

```bash
$ my-cli skills read rx-todos/../../../etc/passwd
# error: invalid path: must be a relative path without '..'
```

CLI 参数来自不可信的 agent,框架已自动校验,业务包**不用**自己处理。
