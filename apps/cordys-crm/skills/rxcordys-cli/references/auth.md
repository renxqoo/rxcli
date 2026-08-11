# Cordys 鉴权原理与故障排查

> SKILL.md 已说明凭证配置方式(login / 环境变量)。本文件讲鉴权的内部原理和常见故障排查。

## 鉴权契约(三个 header)

Cordys 开放接口用静态双 header 鉴权,不走 OAuth / token 交换:

| Header             | 值             | 说明                                       |
| ------------------ | -------------- | ------------------------------------------ |
| `X-Access-Key`     | `<AccessKey>`  | 从个人中心 API Keys 创建                   |
| `X-Secret-Key`     | `<SecretKey>`  | 创建时一次性明文返回,之后掩码,不可再次查看 |
| `X-Request-Source` | 字面量 `SKILL` | 固定标记,标识来自技能接口                  |

> 密钥以明文放 header(非 HMAC 签名)。rxcordys 的 auth plugin 在 `beforeRequest` 钩子里注入这三个 header,业务命令无感。

## 凭证优先级

环境变量(`CORDYS_ACCESS_KEY` + `CORDYS_SECRET_KEY`) > 凭证文件(`~/.rxcli/credentials/cordys.json`)。两者都没有 → 业务命令返回 `authentication/no_credentials`(exit 3)。

> 优先级高 ≠ 更安全。环境变量是为 CI / 临时覆盖设计的;本机长期使用请用 `auth login`(见下节)。

## 凭证安全配置

Cordys 密钥对一旦泄露,持有者即可读写你权限范围内的全部 CRM 数据(线索/客户/合同/回款...)。**配置时怎么放密钥,比凭证优先级更重要。**

### ✅ 推荐:`auth login` 持久化(本机 / agent 长期使用)

```bash
rxcordys auth login --accessKey <AccessKey> --secretKey <SecretKey>
```

- 密钥写入 `~/.rxcli/credentials/cordys.json`,**文件权限 0600**(仅 owner 可读),目录 0700
- 不进 shell 历史(`export` 会留在 `.zsh_history`/`.bash_history`)
- 不进任何配置文件 / `.env`(不会被 git 提交、不会被同机其他用户读)
- agent 调用时**无需传密钥**,rxcordys 自动从此文件读

`CORDYS_CRM_DOMAIN`(部署地址)不敏感,放 shell profile 即可:

```bash
echo 'export CORDYS_CRM_DOMAIN=https://crm.your-company.com' >> ~/.zshrc
```

### ⚠️ 受限:环境变量(仅 CI / 临时覆盖)

环境变量优先级最高,适合 CI runner 注入或临时换 Key。**但不要在本机 profile 里长期 `export` 密钥**:

- 进 shell 历史 → 任何能读 history 的人/进程都能拿到
- 进 `/proc/<pid>/environ`(Linux)→ 同机其他进程可读
- 容易被 `env` 命令、调试日志、崩溃报告连带输出

如必须用,放**只给部署账号读的独立文件**(如 `chmod 600 ~/cordys.env`),启动时 `set -a; source ~/cordys.env; set +a`,不要写进 `.zshrc`。

### ❌ 禁止做法

| 做法                              | 风险                                 |
| --------------------------------- | ------------------------------------ |
| 写进 `.env` 并提交 git            | 永久留在 git 历史,删提交也救不回     |
| 写进 agent / MCP 的 JSON 配置     | 配置文件常是 0644,且会同步/备份/分享 |
| 写进 SKILL.md / README / 任何文档 | 同上,且会随包发布公开                |
| 在聊天 / issue / 日志里贴明文密钥 | 即使删除也可能已被索引               |
| 多人共用同一组 Key                | 无法按人审计/吊销;一人泄露全员遭殃   |

### 多 agent / 多人使用

- 给每个 agent / 每个人**独立创建 Key**(Cordys 个人中心 → API Keys),各自在本机 `auth login`,**不要共享明文密钥**
- 按**最小权限**配角色:只读场景别用管理员 Key
- 怀疑泄露 → Cordys 个人中心立即**禁用该 Key** 并新建,无需改密码

## 凭证隔离

`credentialNamespace = "cordys"`,凭证存 `~/.rxcli/credentials/cordys.json`,与同体系其他 CLI(如 `crm` namespace)互不干扰,不会共用凭证文件。

## 常见故障

完整 exit 码与错误码对照见 SKILL.md「错误处理」。鉴权相关的补充:

| 现象 | 原因 | 处理 |
| ---- | ---- | ---- |
| `authentication/token_expired`(exit 3, 401) | 密钥对失效/错误或已被禁用 | 个人中心确认 Key 仍启用;必要时重建 Key 后 `auth login` |
| HTTP 200 + `code≠100200`(如 `INVALID_KEY`) | Key 无效 | 检查 Access/Secret Key 是否复制完整(无多余空格、无换行) |

## 验证凭证

```bash
rxcordys whoami --json
# {"ok":true,"data":{...用户信息...}}  → 凭证有效
# exit 3 + authentication               → 凭证无效或未配置
```

## 获取密钥对

1. 登录 Cordys 部署地址
2. 左下角「个人中心」→「API Keys」标签 →「新增」
3. 记下返回的 **Access Key** 和 **Secret Key**(Secret Key 仅创建时明文显示一次)
