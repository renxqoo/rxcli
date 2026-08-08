/**
 * @renxqoo/agent-data-cli —— 管道(pipe)
 *
 * 设计依据:docs/01-cli-usage.md "管道用法"、docs/03-envelopes.md "PipeRecord"。
 * 方案(已批准):信封整包。上游 stdout 是完整信封 {ok,data,meta};
 * 下游读完整 stdin → JSON.parse → 取 envelope.data → 数组逐条 yield PipeRecord,单对象 yield 一条。
 * isInPipe:stdin 非 TTY 即管道(下游命令据此分流)。
 *
 * 阶段 1:本文件给接口骨架(createPipeReader);阶段 3 完整实现并接入 pipeline。
 */

import type { PipeApi, PipeRecord } from './types.js'
import { InternalError } from './errs/index.js'

/** stdin 类型:ReadableStream + isTTY 标志(Node 的 process.stdin 有 isTTY)。 */
type StdinLike = NodeJS.ReadableStream & { isTTY?: boolean }

/** 读完整 stream 为字符串(stdin 是 Readable)。 */
async function readAll(stream: StdinLike): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 创建管道读取器。namespace 用于给 PipeRecord.type 兜底(上游信封若未带类型信息)。
 * 实际 type 取上游信封的来源命名空间(若上游 data 项是对象且带 type 字段则优先用它,否则用本 namespace)。
 */
export function createPipeReader(
  stdin: StdinLike = process.stdin as StdinLike,
  fallbackNamespace = 'unknown',
): PipeApi {
  let cached: PipeRecord[] | undefined

  const load = async (): Promise<PipeRecord[]> => {
    if (cached !== undefined) return cached
    const raw = await readAll(stdin)
    if (!raw.trim()) {
      cached = []
      return cached
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(raw)
    } catch (e) {
      throw new InternalError({
        subtype: 'decode_failure',
        message: '管道输入不是合法 JSON',
        cause: e,
      })
    }

    // 信封结构:{ ok, data, meta };data 可能是数组或单对象
    const env = envelope as { data?: unknown }
    const data = env.data
    const records: PipeRecord[] = []

    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object' && 'type' in item) {
          // 上游已是 PipeRecord 形态(多级管道)
          records.push(item as PipeRecord)
        } else {
          const obj = (item ?? {}) as Record<string, unknown>
          records.push({
            type: typeof obj.type === 'string' ? obj.type : fallbackNamespace,
            ...(obj.id !== undefined ? { id: String(obj.id) } : {}),
            data: item,
          })
        }
      }
    } else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      records.push({
        type: typeof obj.type === 'string' ? obj.type : fallbackNamespace,
        ...(obj.id !== undefined ? { id: String(obj.id) } : {}),
        data,
      })
    }
    cached = records
    return records
  }

  return {
    async *in() {
      const records = await load()
      for (const rec of records) {
        yield rec
      }
    },
    isInPipe() {
      return !stdin.isTTY
    },
  }
}

/** 空管道(非管道场景用)。 */
export function emptyPipe(): PipeApi {
  return {
    async *in() {
      /* 无数据 */
    },
    isInPipe() {
      return false
    },
  }
}
