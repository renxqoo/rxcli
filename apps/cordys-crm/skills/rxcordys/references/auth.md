# Cordys 鉴权原理与故障排查

> SKILL.md 已说明凭证配置方式(login / 环境变量)。本文件讲鉴权的内部原理和常见故障排查。

## 鉴权契约(三个 header)

Cordys 开放接口用静态双 header 鉴权,不走 OAuth / token 交换:

| Header | 值 | 说明 |
|--------|-----|------|
| `X-Access-Key` | `<AccessKey>` | 从个人中心 API Keys 创建 |
| `X-Secret-Key` | `<SecretKey>` | 创建时一次性明文返回,之后掩码,不可再次查看 |
| `X-Request-Source` | 字面量 `SKILL` | 固定标记,标识来自技能接口 |

> 密钥以明文放 header(非 HMAC 签名)。rxcordys 的 auth plugin 在 `beforeRequest` 钩子里注入这三个 header,业务命令无感。

## 凭证优先级

环境变量(`CORDYS_ACCESS_KEY` + `CORDYS_SECRET_KEY`) > 凭证文件(`~/.rxcli/credentials/cordys.json`)。两者都没有 → 业务命令返回 `authentication/no_credentials`(exit 3)。

## 凭证隔离

`credentialNamespace = "cordys"`,凭证存 `~/.rxcli/credentials/cordys.json`,与同体系其他 CLI(如 `crm` namespace)互不干扰,不会共用凭证文件。

## 常见故障

| 现象 | 原因 | 处理 |
|------|------|------|
| `authentication/no_credentials`(exit 3) | 未配置凭证 | `rxcordys auth login` 或设环境变量 |
| `authentication/token_expired`(exit 3, 401) | 密钥对失效/错误 | demo 环境每天回滚 → 重新创建 Key;自部署检查 Key 是否被禁用 |
| `authorization/forbidden`(exit 3, 403) | Key 有效但无数据权限 | Cordys 个人中心 → API Keys → 确认 Key 启用;管理员确认角色权限 |
| HTTP 200 + `code≠100200` | Key 无效(`INVALID_KEY`) | 检查 Access/Secret Key 是否复制完整(无多余空格) |

## 验证凭证

```bash
rxcordys whoami --json
# {"ok":true,"data":{...用户信息...}}  → 凭证有效
# exit 3 + authentication               → 凭证无效或未配置
```

## 获取密钥对

1. 登录 Cordys(自部署或 demo.cordys.cn)
2. 左下角「个人中心」→「API Keys」标签 →「新增」
3. 记下返回的 **Access Key** 和 **Secret Key**(Secret Key 仅创建时明文显示一次)

> demo 环境(`demo.cordys.cn`,账号 `cordys`/`cordys`)的 Key 每天随数据回滚失效;自部署的 Key 永久有效(除非手动删除)。
