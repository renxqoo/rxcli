# README 生成指南

> README 是给人(开发者/用户)看的项目入口;SKILL.md 是给 AI agent 看的触发指令。CLI 做完后两者都要有——本文档标准化 README 的结构和信息来源,让 agent 照着生成完整 README,不靠记忆、不漏改。

---

## 1. README 标准结构(7 节)

每节都标注「信息从哪来」,生成时直接取,不用编:

| 节 | 内容 | 信息来源 |
| -- | ---- | -------- |
| ① 简介 | 一句话定位 + 基于什么框架 | `defineCli.description` + `package.json` |
| ② 快速开始 | 装 CLI → 装 Skill → 配凭证(三步) | `package.json` name/bin + `skills sync` + 鉴权方式(见 §3) |
| ③ 功能 | 模块表格(每 namespace 一行) | `defineCli` 的 `namespaces` |
| ④ 常用命令 | 5-8 个高频示例 | 从命令表挑最高频操作 |
| ⑤ 输出契约 | 统一输出格式格式 `{ok,source,data,meta}` | 框架标准(固定) |
| ⑥ 开发 | build / test / typecheck | `package.json.scripts` |
| ⑦ 技术决策 | 鉴权方式、命名约定等 | auth 实现 + §0 命名检查 |

> 不要漏节。尤其 ②「装 Skill」最常漏——用户装了 CLI 但 AI 工具读不到 skill 就不会触发。

---

## 2. 完整模板

````markdown
# {{包名}} ({{bin 名}})

{{一句话简介}} —— 基于 [@renxqoo/agent-data-cli](框架链接) 框架,{{覆盖什么业务}}。

## 快速开始

### 一键安装(推荐)

```bash
npx {{包名}} install
```

自动完成:① 全局安装 CLI → ② 安装 Skill 到 `~/.agents/skills/` → ③ 凭证配置。需 Node ≥ 18。

### 手动安装(分步,等价于一键)

**第 1 步:安装 CLI**

```bash
npm install -g {{包名}}
```

安装后跑 `{{bin 名}} --help` 确认可用。

**第 2 步:安装 Skill(让 AI 工具发现)**

```bash
{{bin 名}} skills sync
```

同步到 `~/.agents/skills/`(Claude Code / Cursor / Trae 等的通用发现路径)。验证:

```bash
{{bin 名}} skills list
```

**第 3 步:配置凭证**

{{按鉴权类型填,见 §3 三种分支}}

## 功能

覆盖 {{业务域}}:

| 模块 | 说明 |
|------|------|
| `{{namespace}}` | {{一句话}} |
| ... | ... |

## 常用命令

```bash
{{bin 名}} {{namespace}} {{cmd}} --json    # {{用途}}
... (5-8 个高频示例)
```

加 `--dryRun` 仅校验不提交;完整命令见 `{{bin 名}} --help`。

## 输出契约

遵循 agent-data-cli 统一输出格式:`{ ok, source, data, meta }`。列表命令自动计算 `meta.pagination.complete`。

## 开发

```bash
pnpm --filter {{包名}} build       # 编译
pnpm --filter {{包名}} test         # 测试
pnpm --filter {{包名}} typecheck    # 类型检查
```

Skill 文档:`skills/{{skill 名}}/SKILL.md`。

## 技术决策

- **命名**:npm 包 `{{包名}}` / bin `{{bin 名}}` / skill `{{skill 名}}` / 凭证 namespace `{{ns}}`。
- {{鉴权方式、业务码处理等关键决策,2-4 条}}
````

---

## 3. 「第 3 步:配置凭证」按鉴权类型分支

对应主 SKILL.md §4 决策树,三种 CLI 类型配不同的凭证步骤:

### 类型 A:无鉴权(公开 API / 内网)

没有第 3 步。README 的快速开始只有两步(装 CLI + 装 Skill)。简介里注明"无需鉴权,开箱即用"。

### 类型 B:OAuth 鉴权(defineAuth 工厂)

```markdown
**第 3 步:配置凭证**

首次使用需注册 + 登录(OAuth device flow):

```bash
{{bin 名}} auth register --token <注册令牌>   # 首次注册(令牌从管理员获取)
{{bin 名}} auth login                          # 浏览器扫码授权
```

验证:`{{bin 名}} auth status` 显示已登录。
```

> OAuth 的 login 是 device flow,README 里写 `auth login` 给人看(交互式扫码);SKILL.md 里必须写 split-flow 两步(给 agent 用,避免阻塞)。两者受众不同,写法不同。

### 类型 C:静态密钥(手写 auth Plugin,如 API Key / HMAC)

```markdown
**第 3 步:配置凭证**

凭证从 {{系统}}「{{入口}}」获取,两种方式任选:

```bash
# 方式 A:持久化(推荐,写 ~/.rxcli/credentials/{{ns}}.json)
{{bin 名}} auth login --access-key <AK> --secret-key <SK>

# 方式 B:环境变量(CI / 临时)
export {{PREFIX}}_ACCESS_KEY=<AK>
export {{PREFIX}}_SECRET_KEY=<SK>
```

验证:`{{bin 名}} whoami` 返回用户信息即凭证有效。
```

---

## 4. 一键安装 `npx <pkg> install`

框架自带 install 向导(`runInstallWizard`),入口拦截 `argv[0]==='install'`。向导自动跑:

| 步骤 | 动作 | 适用 |
| ---- | ---- | ---- |
| ① | `npm install -g <包名>` | 全局装 CLI |
| ② | `npx skills add` 或 `<bin> skills sync` | 装 Skill 到 `~/.agents/skills/` |
| ③ | `<bin> auth register` | 注册(OAuth CLI 才有,静态密钥跳过) |
| ④ | `<bin> auth login` | 登录授权(OAuth:浏览器;静态密钥:存 key) |

**README 写法**:一键安装作为首选,手动三步作为备选(等价)。这样用户一条命令搞定,出问题能分步排查。

> 静态密钥 CLI 的向导步骤③④ 不完全适配(register 是 OAuth 概念),但这两步失败不阻断——①② 会正常完成。README 里注明即可。

---

## 5. 避坑(基于实战)

1. **🔥 别漏「装 Skill」步骤** —— 用户 `npm install -g` 装了 CLI,但没跑 `skills sync`,AI 工具读不到 skill → 不触发。README 的快速开始必须含这一步。

2. **包名 / bin / skill 目录 / namespace 要一致** —— 对应主 SKILL.md §0 命名检查。README 里把这四个名字列清楚(技术决策节),避免文档和代码漂移。

3. **README 和 SKILL.md 的安装步骤要同步** —— README 给人看(可交互),SKILL.md 给 agent 看(split-flow 非阻塞)。内容对齐但写法不同。

4. **常用命令别超过 8 个** —— 挑最高频的(列表/详情/搜索/统计/新增),其余指向 `--help`。太多反而让用户抓不住重点。

5. **技术决策节记录"为什么这么做"** —— 比如"手写 auth plugin 而非 defineAuth,因为框架 injectAuthHeader 只支持单 header"。这些决策在 README 里一句话带过,给后续维护者/读者交代关键取舍。
