/** crm 全局配置:统一管理本地目录、后端地址、skill 目录。 */
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本地状态目录(凭证/配置存放处)。 */
export const RXCLI_DIR = join(homedir(), '.rxcli')

/**
 * OAuth/auth 中间层地址(device flow / token / user_info / revoke / register)。
 *
 * 由 RXCLI_AUTH_BASE_URL 环境变量配置(未设则用默认值)。
 * 该地址供 auth Plugin 的 oauth.baseUrl、register 命令使用。
 */
export const AUTH_BASE_URL = process.env.RXCLI_AUTH_BASE_URL ?? 'http://localhost:3000'

/**
 * 业务 API 网关地址(命令经中间层 /proxy/api/* 访问业务接口)。
 *
 * 由 RXCLI_API_BASE_URL 环境变量配置(未设则用默认值)。
 * 业务请求走中间层的 /proxy 网关(中间层验 JWT、换 company_token 转发公司应用),
 * 故默认与 AUTH_BASE_URL 同址(均为中间层)。
 */
export const API_BASE_URL = process.env.RXCLI_API_BASE_URL ?? 'http://120.26.219.32/'

/** skill 文件目录(SKILL.md + references 所在)。dist/config.js → ../skills/ */
export const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
