# SKILL.md 完整模板 + 自动生成机制

> SKILL.md 是给 AI agent 读的指令文档,决定 agent 何时触发你的 CLI。cli-sdk 用"机械信息自动生成 + 语义信息人写 + 标记块隔离"机制,保证两边永不漂移。

---

## 1. 两种信息,两种产出

| 信息类型     | 例子                                             | 谁产出                        |
| ------------ | ------------------------------------------------ | ----------------------------- |
| **机械信息** | 命令签名、参数列表、类型、必填、默认值           | `defineCommands` **自动生成** |
| **语义信息** | description、"用户说X用什么"、前置条件、错误处理 | 人写                          |

加一个参数要同步改 SKILL.md 和代码 → 必然漂移。机械信息从代码生成,保持同步。

---

## 2. skill 命令一览(自动注入)

业务包加 `skillsDir: './skills'` 后,自动有这些命令:

| 命令                                          | 干什么                                              |
| --------------------------------------------- | --------------------------------------------------- |
| `my-cli skills list`                          | 列出所有 skill(返回统一输出)                            |
| `my-cli skills read <name>`                   | 读 SKILL.md 原文(stdout,**输出契约例外**)              |
| `my-cli skills read <name>/references/foo.md` | 读 reference 文件(带路径穿越校验)                   |
| `my-cli skills sync`                          | 同步到 `~/.agents/skills/`(主流 agent 工具发现路径) |
| `my-cli skills gen <name>`                    | 刷新已有 SKILL.md 的命令表(AUTO-GEN 块内)           |
| `my-cli skills gen <name> --init`             | 首次生成整份 SKILL.md 骨架(带 `{{FILL}}` 占位)      |
| `my-cli skills gen <name> --init --lang zh`   | 生成中文骨架(默认 `--lang en` 英文)                |

---

## 3. 完整 SKILL.md 模板

````markdown
---
name: rx-todos
description: 查询和管理待办。当用户需要查待办、看待办列表、标记待办完成、新建待办时使用。
metadata:
  requires:
    bins: ["my-cli"]
  cliHelp: "my-cli --help"
  category: business
---

# todos

通过 CLI 查询后端待办服务,支持列表查询、详情、创建、标记完成。

**调用命令前先确认登录状态**:业务命令需要凭证,未登录会直接失败。读 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md)(如适用)。

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

**禁止直接跑 `my-cli auth login`(会阻塞数分钟,agent 拿不到 URL)**。用三步:

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
{ "ok": true, "source": "rx-todos", "data": [{ "id": "t_1001", "title": "写周报", "done": false }] }
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
````
### 错误处理

| 错误                      | 处理                                 |
| ------------------------- | ------------------------------------ |
| `not_found` / exit 1      | 待办不存在,用 `todos list` 查有效 ID |
| exit 3 + `no_credentials` | 未登录,`my-cli auth login`           |
| exit 4 网络错误           | 稍后重试                             |

````

---

## 4. frontmatter 规范

frontmatter **必须符合 Anthropic 官方 skill 规范**。具体的字段白名单、命名规则、长度限制等约束**以官方 [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) 当前规范为准**(官方会演进,不在此抄录,避免过时)。

> 关键:`gen --init` 生成的骨架(见下)已只放官方允许的字段,直接可用;若你手改 frontmatter,请对照官方规范,跑 skill-creator 的校验确认合规。

`gen --init` 生成的 frontmatter 形态(只含稳定字段):

```yaml
---
name: <skill 名,与目录名一致>
description: <一句话描述何时用,agent 靠它触发>
metadata:                       # 可选,嵌套键按需放 agent 需要的元信息
  requires:
    bins: ["my-cli"]            # 依赖的 bin(让 agent 知道要先装)
  cliHelp: "my-cli --help"      # 提示用户跑这个看完整命令
  category: business            # 分类(business / devops / data / ...)
---
```

> **不要加 `version`**:版本信息放 `package.json`,不进 frontmatter。历史上 `version` 曾被写进骨架,但官方规范不允许顶层 version 字段,已从 `gen.ts` 移除。

### description 写法(skill 触发质量的关键)

description 是 agent 决定**何时触发** skill 的唯一依据。官方明确:Claude 倾向 undertrigger(该用而不用),因此 description 需主动把触发条件讲清楚、讲全。

**4 条原则:**

1. **写"何时用",不写"是什么"** —— 描述用户意图和场景,而非工具本身。

   正例 `查询和管理待办。当用户需要查待办、看待办列表、标记待办完成、新建待办时使用。`
   反例 `待办管理工具`(太抽象,agent 难匹配)

2. **覆盖用户的主要说法(不止一种)** —— 用户不会直说命令名。将同义、口语、缩写、甚至错别字的说法都纳入 description。

   正例 `...当用户提到 线索、客户、商机、合同、回款、发票、订单、CRM,或想查/改系统里的业务记录时使用——即使用户没说"CRM"也要触发。`
   反例 只写一个词 `CRM`

3. **划清边界,防误触发** —— 与相邻 skill 容易混淆时,点明"这个管什么、不管什么",让 agent 在歧义时选对。

   正例 `...仅限 A 股,港股/美股/基金/加密货币不在范围内。`

4. **明确鼓励触发** —— Claude 默认倾向不使用 skill,description 偏弱则不触发。需明确表达触发意图。

   正例 `...即使用户没明说"rx60s"也要触发。`

**参考:** 仓库已有 skill(`apps/a-stock`、`apps/cordys-crm`、`apps/60s` 的 SKILL.md frontmatter)的 description 均纳入大量触发词 + 边界声明,该写法经验证触发率较高。

> description 长度有官方上限(以 skill-creator 当前规范为准),触发词虽多也不宜超长。发布前用真实任务评估验证触发率(见 §11)。

---

## 5. AUTO-GEN 标记块

```markdown
<!-- AUTO-GEN:START commands -->
<!-- 本区块由 `my-cli skills gen` 自动生成,不要手改 -->

... 自动生成的命令索引表(操作 + 命令签名) ...
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
# 中文项目加 --lang zh:my-cli skills gen rx-todos --init --lang zh

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

### AUTO-GEN 块只含命令索引,参数细节进 references

AUTO-GEN 块只生成命令索引表(操作 + 命令签名),**不生成参数说明**——参数细节(类型/必填/默认/枚举/返回字段)交给 `references/` 按需加载。这是 progressive disclosure 的设计:SKILL.md 是路由层(agent 读完知道有哪些命令),references 是细节层(agent 构造精确调用时才读)。

所以每个有参数的 namespace 都应在 `references/` 里有对应的参数文档。命令少的 CLI(1-2 个命令)也可以把参数说明直接写在 SKILL.md 语义部分(块外,gen 不碰)。


### skills 分发:把 skillsSource 传给 install 向导

业务包入口读取 `skillsSource`，并显式传给 `runInstallWizard({ skillsSource })`，决定向导怎么装 skills:

| `skillsSource`                         | install 向导行为                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 空(默认)                               | 跑 `my-cli skills sync`,把包内本地 `skills/` 写到 `~/.agents/skills/`(主流 agent 工具发现路径) |
| 设了 URL(如 `https://skills.sh/p/xxx`) | 优先 `npx skills add <url>`(覆盖 30+ AI 工具发现路径),失败回退本地 sync                        |

业务包入口拦截 `argv[0]==='install'` → `runInstallWizard({ skillsSource })`(4 步:npm i -g → 装 skills → register → login)。`defineCli({ skillsSource })` 当前不会自动转交该值；必须显式传给向导。详见主 SKILL.md §7。

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

**desc 填写成本低,对文档质量提升明显。**

---

## 10. 安全:路径穿越校验

`skills read` 和 `skills gen` 拒绝路径穿越:

- 拒绝绝对路径(`/etc/...` 和 Windows `C:\...`)
- 拒绝含 `..` 的路径(归一化后检查)
- 只允许相对路径
- realpath 必须仍在 `skillsDir` 内，指向外部的 symlink 也会拒绝

```bash
$ my-cli skills read rx-todos/../../../etc/passwd
# error: invalid path: must be a relative path without '..'
```

CLI 参数来自不可信的 agent,框架已自动校验,业务包**不用**自己处理。

`skills sync` 会在目标目录的 `.rxcli-sync-manifests/` 按源目录记录 ownership，只清理当前源上次同步但本次已删除的 skill，不会扫描删除其他业务包或用户自己的 skill；同名 skill 还有其他 owner 时会恢复其他源的副本。

---

## 11. 与官方 skill-creator 规范对齐

SKILL.md 要符合 Anthropic 官方 [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) 规范。生成 SKILL.md 的工作流见 §6;这里只讲与官方规范对齐相关的事。

### frontmatter 合规

§4 的 frontmatter 规范已对齐官方。框架生成的骨架只放官方允许的字段(无 version 等);你手改 frontmatter 时不要加 version 等非官方字段。若想确认手改后仍合规,可用 skill-creator 的校验脚本(以官方仓库当前内容为准)。

### 发布前验证:用 skill-creator 验证 skill 质量

单元测试 / 端到端测试(能用真实数据就用真实数据,见 `references/testing.md`)只能验证代码跑得通,**验证不了 skill 写得好不好**(agent 该触发时会不会触发?能不能靠 SKILL.md 自发完成真实任务?)。**发布前必须跑一轮真实任务评估**(让 agent 带着 skill 真实调 CLI 完成任务),这是代码测试替代不了的。流程见 `references/testing.md` §9。

### 触发不准?打包分发?

- **触发不准**(agent 该触发时不触发,或误触发):用 skill-creator 的 description 自动优化能力,给一批 should-trigger / should-not-trigger 的真实 query 迭代 description。
- **打包分发**:skill-creator 可把 skill 打包成单文件,供 `skills add` 安装。

这两项的具体脚本以官方仓库为准。
