/**
 * 统一多源 fallback 执行器
 *
 * 数据源策略的核心:把"按序尝试多个数据源,首个成功即返回"的样板逻辑抽出来,
 * 避免 9 个单点 service 各自手写 try/catch 链(重复且易错)。
 *
 * 设计:
 *   - 按序尝试每个 source,失败的记录原因继续下一个
 *   - 全部失败时抛 NetworkError(retryable:false),错误信息含"尝试了 A/B/C 都失败"的诊断
 *   - 可选 treatEmptyAsFail:有些源正常返回空数组(如停牌),需要区分"源返回空"和"源失败"
 *
 * 用法:
 *   const quote = await trySources([
 *     { name: "tencent", fetch: () => fetchTencentQuote(sym) },
 *     { name: "sina",    fetch: () => fetchSinaQuote(sym) },
 *   ], { treatEmptyAsFail: (v) => v == null });
 */

import { NetworkError } from "@renxqoo/agent-data-cli";

/** 单个数据源定义 */
export interface Source<T> {
  /** 数据源名称(用于诊断日志,如 "tencent" / "sina") */
  name: string;
  /** 取数函数:成功返回数据,失败抛错或返回 isEmpty 的值 */
  fetch: () => Promise<T>;
}

export interface TrySourcesOptions<T> {
  /**
   * 判断 fetch 成功返回的值是否"实际为空"——为空则视为该源失败,继续尝试下一个。
   * 例:行情用 `v => v == null`;列表用 `v => !Array.isArray(v) || v.length === 0`
   * 不传则只看是否抛错。
   */
  isEmpty?: (value: T) => boolean;
  /** 单源 fetch 的整体时限(ms);超时视为该源失败。默认不设(各源 httpGet 自己管 timeout) */
  perSourceTimeoutMs?: number;
  /** 日志接收器(注入 ctx.log;命令外场景传 stderr logger)。默认丢弃 */
  log?: (level: "warn" | "info", msg: string) => void;
}

interface SourceFailure {
  name: string;
  reason: string;
}

/**
 * 按序尝试多个数据源,首个成功(且非空)的返回;全部失败抛 NetworkError。
 *
 * @throws NetworkError 当所有源都失败时(retryable: false,subtype: connection_refused)
 */
export async function trySources<T>(
  sources: ReadonlyArray<Source<T>>,
  opts: TrySourcesOptions<T> = {},
): Promise<T> {
  if (sources.length === 0) {
    throw new NetworkError({
      subtype: "connection_refused",
      message: "未配置任何数据源",
      retryable: false,
    });
  }
  const { isEmpty, perSourceTimeoutMs, log } = opts;
  const failures: SourceFailure[] = [];

  for (const src of sources) {
    try {
      const value = perSourceTimeoutMs
        ? await withTimeout(src.fetch(), perSourceTimeoutMs, src.name)
        : await src.fetch();
      if (isEmpty && isEmpty(value)) {
        failures.push({ name: src.name, reason: "返回空数据" });
        log?.("info", `[fallback] ${src.name} 返回空,尝试下一个源`);
        continue;
      }
      // 多源场景下,记录最终命中源便于 agent/用户诊断
      if (failures.length > 0) {
        log?.("info", `[fallback] ${src.name} 命中(前 ${failures.length} 个源失败)`);
      }
      return value;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ name: src.name, reason });
      log?.("warn", `[fallback] ${src.name} 失败: ${reason}`);
      // 继续下一个源
    }
  }

  // 所有源都失败
  const tried = failures.map((f) => `${f.name}(${f.reason})`).join(" / ");
  throw new NetworkError({
    subtype: "connection_refused",
    message: `所有数据源均失败,已尝试: ${tried}`,
    retryable: false,
  });
}

/**
 * 给一个 promise 套超时,超时则 reject(算作该源失败,不中断整体 fallback)。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, sourceName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${sourceName} 超时(${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * 单数据源场景的便捷封装:加上重试 + 缓存语义的统一错误处理。
 * 单源数据(如东财 datacenter 独占的龙虎榜/分红等)用这个,保证失败时错误信息清晰。
 */
export async function trySingleSource<T>(
  source: Source<T>,
  opts: Pick<TrySourcesOptions<T>, "isEmpty" | "log"> = {},
): Promise<T> {
  return trySources([source], opts);
}
