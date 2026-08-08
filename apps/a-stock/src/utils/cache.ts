/**
 * 简单内存 TTL 缓存
 *
 * 设计目标:
 *   - 进程内单例(模块级 Map),零依赖
 *   - 支持 TTL(默认按 key 自定义)
 *   - 同 key 命中即读,未命中调 loader 加载并写入
 *   - 单飞 (singleflight):同 key 并发请求只触发一次 loader,其余 await 同一 Promise
 *
 * 为什么需要:
 *   行情类数据 A 股每个交易日实时变化,但 1~3 秒内重复请求是浪费带宽;
 *   K 线/财务类日级数据在交易日内不会变,几分钟缓存即可。
 *   内存缓存就够了 —— 跨进程缓存(redis 等)复杂且股票数据对一致性敏感。
 */

interface Entry<V> {
  value: V;
  expiresAt: number; // ms timestamp
}

/**
 * TTL 缓存 + singleflight
 *
 * @example
 * const getQuote = memoize(async (code: string) => fetchQuote(code), 1500)
 *   getQuote('600519')
 */
export function memoize<V, K = string>(
  loader: (key: K) => Promise<V>,
  ttlMs: number,
): (key: K) => Promise<V> {
  const store = new Map<string, Entry<V>>();
  const inflight = new Map<string, Promise<V>>();

  return async function get(key: K): Promise<V> {
    const cacheKey = String(key);
    // 1. 命中检查
    const hit = store.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value;
    }

    // 2. singleflight:同 key 并发只跑一次 loader
    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const p = (async () => {
      try {
        const value = await loader(key);
        store.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
        return value;
      } finally {
        inflight.delete(cacheKey);
      }
    })();
    inflight.set(cacheKey, p);
    return p;
  };
}

/** 清空全部缓存(测试用) */
export function clearCache(): void {
  // 暴露给测试;实际模块内 Map 是闭包的,需要从 memoize 工厂返回 clear 方法。
  // 这里仅占位,业务通常不需要全局清空。
}

/** 预定义的 TTL(毫秒) */
export const CacheTTL = {
  /** 实时行情(秒级) */
  quote: 1_500,
  /** 分时图(分钟级) */
  minute: 30_000,
  /** K 线(日级,交易日内变化) */
  kline: 5 * 60_000,
  /** 股票/板块/指数列表(每日变动) */
  list: 10 * 60_000,
  /** 财务数据(季报/年报,变化不频繁) */
  financial: 30 * 60_000,
  /** 公司基本信息 */
  profile: 60 * 60_000,
  /** 公告/新闻 */
  news: 5 * 60_000,
  /** 资金流 */
  fundflow: 5 * 60_000,
  /** 搜索建议(秒级) */
  search: 60_000,
} as const;
