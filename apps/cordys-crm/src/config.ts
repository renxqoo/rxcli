/**
 * rxcordys 全局配置:统一管理本地目录、后端地址、skill 目录、凭证命名空间。
 *
 * 对齐 CordysCRM-skills 原版:
 *   - 鉴权走静态双 header(X-Access-Key / X-Secret-Key / X-Request-Source: SKILL),无 OAuth
 *   - 凭证从环境变量读(CORDYS_ACCESS_KEY / CORDYS_SECRET_KEY),也可用 `rxcordys auth login` 持久化
 *   - baseUrl 由 CORDYS_CRM_DOMAIN 配置,默认 https://www.cordys.cn
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 本地状态目录(凭证/配置存放处),与 rxcli 体系共用 ~/.rxcli。 */
export const RXCLI_DIR = join(homedir(), ".rxcli");

/**
 * Cordys CRM 后端地址(所有端点路径直接拼到此域名根)。
 *
 * 由 CORDYS_CRM_DOMAIN 环境变量配置(未设则用默认值)。
 * 注意:Cordys 端点路径不带 /api 前缀,如 /lead/page、/account/{id}。
 */
export const API_BASE_URL = process.env.CORDYS_CRM_DOMAIN ?? "https://www.cordys.cn";

/**
 * 凭证命名空间(~/.rxcli/credentials/<ns>.json)。
 *
 * 用 `cordys` 而非 `crm`,避免与 apps/crm(@renxqoo/cli)的 `crm` namespace 撞名共用凭证。
 */
export const CREDENTIAL_NAMESPACE = "cordys";

/** skill 文件目录(SKILL.md + references 所在)。dist/config.js → ../skills/ */
export const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
