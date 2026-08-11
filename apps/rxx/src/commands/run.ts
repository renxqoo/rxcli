/**
 * rxx —— `rxx run <service> <...>`:动态调度入口
 *
 * 拆成两步(S4):
 *   - assembleApp(manifest):manifest → defineCli App(纯装配,可复用/可测试)
 *   - runService(name, args):加载 manifest + assembleApp + app.run(编排)
 *
 * 核心:每次 rx run,按 argv 选服务 → 现场 build 一个 defineCli App → app.run(rest)。
 * defineCli 的 routed 数组是装配期不可变,所以每个动态服务现场 build 自己的 App。
 */

import { defineCli, type App } from "@renxqoo/agent-data-cli";
import type { CommandSpec, CommandGroup } from "@renxqoo/agent-data-cli";
import { loadManifest } from "../manifest/loader.js";
import { manifestToCommands } from "../executor/dynamic-command.js";
import { buildAuthFromManifest } from "../auth/from-manifest.js";
import type { Manifest } from "../manifest/schema.js";

/**
 * 把 manifest 装配成一个 defineCli App(纯装配,不发请求)。
 * 拆出来便于测试和未来扩展(dry-run / 缓存预热)。
 */
export async function assembleApp(manifest: Manifest): Promise<App> {
  const auth = await buildAuthFromManifest(manifest);
  const { commands, namespaces } = manifestToCommands(manifest);
  return defineCli({
    name: manifest.name,
    createState: () => ({}),
    binName: manifest.name,
    description: manifest.description,
    plugins: [auth],
    commands: commands as Record<string, CommandSpec<any, unknown>>,
    namespaces: namespaces as Record<string, CommandGroup>,
    baseUrl: manifest.api.baseUrl,
    errorOnStatus: manifest.errorOnStatus as Record<string, string> | undefined,
  });
}

/**
 * 运行一个动态服务:加载 manifest → assembleApp → app.run(serviceArgs)。
 */
export async function runService(serviceName: string, serviceArgs: string[]): Promise<void> {
  const manifest = loadManifest(serviceName);
  const app = await assembleApp(manifest);
  await app.run(serviceArgs);
}
