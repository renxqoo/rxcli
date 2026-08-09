# @renxqoo/rxcordys-cli (rxcordys)

Cordys CRM L2C 全链路 agent 命令行工具 —— 基于 [`@renxqoo/agent-data-cli`](../../packages/cli-sdk) 框架,全量覆盖 CordysCRM 接口。

## 快速开始

### 一键安装(推荐)

```bash
npx @renxqoo/rxcordys-cli install
```

自动完成三步:① 全局安装 CLI → ② 安装 Skill 到 `~/.agents/skills/`(AI 工具发现路径)→ ③ 凭证配置。需 Node ≥ 18。

> `npx` 无需预装,跑完即得全局 `rxcordys` 命令 + 已就位的 skill。

### 手动安装(分步,等价于一键安装)

如果一键安装某步失败或想单独执行:

**第 1 步:安装 CLI**

```bash
npm install -g @renxqoo/rxcordys-cli
```

安装后跑 `rxcordys --help` 确认可用。不想全局装?用 `npx @renxqoo/rxcordys-cli <命令>` 临时执行。

**第 2 步:安装 Skill(让 AI 工具发现)**

把 skill 同步到 `~/.agents/skills/`(Claude Code / Cursor / Trae 等 AI 工具的通用发现路径):

```bash
rxcordys skills sync
```

同步后 AI 工具即可在用户提到线索/客户/商机/合同等关键词时自动触发本 skill。验证:

```bash
rxcordys skills list                # 列出已装的 skill
ls ~/.agents/skills/rxcordys-cli/   # 确认 skill 文件就位
```

**第 3 步:配置凭证

凭证从 Cordys 管理后台「个人中心 → API Keys」获取,两种方式任选:

```bash
# 方式 A:持久化(推荐,写 ~/.rxcli/credentials/cordys.json)
rxcordys auth login --access-key <AccessKey> --secret-key <SecretKey>

# 方式 B:环境变量(CI / 临时)
export CORDYS_ACCESS_KEY=<AccessKey>
export CORDYS_SECRET_KEY=<SecretKey>
# 自部署:export CORDYS_CRM_DOMAIN=https://你的地址
```

验证:`rxcordys whoami` 返回用户信息即凭证有效。

## 功能

覆盖线索 → 客户 → 商机 → 合同 → 回款 → 发票 → 订单的 L2C 全流程:

| 模块 | 说明 |
|------|------|
| `leads` | 线索 CRUD + 转客户(transition)/ 转商机(transform) |
| `accounts` | 客户 CRUD + 客户 360(合同/商机/订单/回款/发票子资源 + 统计) |
| `opportunities` | 商机 CRUD + 报价单(quotation) |
| `contacts` | 联系人 CRUD |
| `contracts` | 合同 + 回款计划/记录 + 工商抬头 + 统计 |
| `invoices` | 发票 |
| `orders` | 订单 + 统计 |
| `follows` | 跟进计划/记录(跨 lead/account/opportunity) |
| `approvals` | 审批待办/动作/资源/流程配置 |
| `stats` | 模块金额统计 + 首页看板 |
| `records` | 跨模块通用(view/get/page/search/contact/product/form) |
| `util` | whoami/org/members/glocount/raw 透传 |

## 常用命令

```bash
rxcordys leads page --json                              # 查询线索(分页)
rxcordys accounts page "张三"                           # 搜客户
rxcordys accounts sub contract <customerId>            # 某客户名下的合同
rxcordys contracts stat                                # 合同金额统计
rxcordys accounts add '{"name":"客户A"}' --yes         # 新增客户(高危需 --yes)
rxcordys leads transition '{"clueId":"L1","name":"X"}' --yes  # 线索转客户
rxcordys approvals todo pending                        # 待我审批
rxcordys util raw GET /lead/view/view                  # 透传未覆盖端点
```

加 `--dryRun` 仅校验不提交;完整命令见 `rxcordys --help`。

## 输出契约

遵循 agent-data-cli 信封:`{ ok, source, data, meta }`。列表命令自动计算 `meta.pagination.complete`。

## 开发

```bash
pnpm --filter @renxqoo/rxcordys-cli build       # 编译
pnpm --filter @renxqoo/rxcordys-cli test         # 测试(61 用例)
pnpm --filter @renxqoo/rxcordys-cli typecheck    # 类型检查
```

Skill 文档:`skills/rxcordys-cli/SKILL.md`(手写维护,决策信息前置)。

## 技术决策

- **命名**:npm 包 `@renxqoo/rxcordys-cli` / bin 命令 `rxcordys` / skill `rxcordys-cli` / 凭证 namespace `cordys`。
- **手写 auth plugin**(非 `defineAuth`):Cordys 用静态双 header,框架 `injectAuthHeader` 只支持单 header,故手写 `beforeRequest` 注入。
- **业务码解包**:Cordys 业务错误可能 HTTP 200 + `code≠100200`,所有命令经 `unwrap()` 解包校验。
- **credentialNamespace = `cordys`**:避免与 `apps/crm` 的 `crm` namespace 撞名共用凭证。
