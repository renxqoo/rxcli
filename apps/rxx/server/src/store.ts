/**
 * rxx-server —— 动态服务的通用内存 store
 *
 * 运行时通过 POST /__admin/manifests 注册的服务,数据存在这里(按 service name 隔离)。
 * 支持通用 CRUD,响应格式统一为 { items, hasMore, nextCursor },供动态 manifest 映射。
 *
 * 这套 store + 动态注册端点存在的目的:证明 rxx 客户端是纯动态的——
 * 服务端运行时新增一个全新接口,客户端零改动就能 init + run。
 */

export interface StoreRecord {
  id: string;
  [key: string]: unknown;
}

/** service name → resource name → records[]。 */
const stores = new Map<string, Map<string, StoreRecord[]>>();
/** service name → resource name → 已分配的最大 ID 序号(防删后 ID 碰撞)。 */
const idCounters = new Map<string, Map<string, number>>();

function getStore(service: string, resource: string): StoreRecord[] {
  let svc = stores.get(service);
  if (!svc) {
    svc = new Map();
    stores.set(service, svc);
  }
  let recs = svc.get(resource);
  if (!recs) {
    recs = [];
    svc.set(resource, recs);
  }
  return recs;
}

function nextId(service: string, resource: string): string {
  let svc = idCounters.get(service);
  if (!svc) {
    svc = new Map();
    idCounters.set(service, svc);
  }
  const n = (svc.get(resource) ?? 0) + 1;
  svc.set(resource, n);
  return `${resource}_${String(n).padStart(3, "0")}`;
}

/**
 * seed 一批初始数据(注册时调用)。注册即重置:重复注册同一 service+resource
 * 时清空旧数据再 seed,保证测试隔离(避免跨测试 create 残留污染下次 seed)。
 */
export function seedStore(service: string, resource: string, records: StoreRecord[]): void {
  const store = getStore(service, resource);
  store.length = 0; // 清空旧数据(注册即重置)
  let maxSeq = 0;
  for (const rec of records) {
    store.push(rec);
    const m = String(rec.id).match(/(\d+)$/);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1]!, 10));
  }
  // 重置 counter(seed 数据里的最大序号)
  let svc = idCounters.get(service);
  if (!svc) {
    svc = new Map();
    idCounters.set(service, svc);
  }
  svc.set(resource, maxSeq);
}

export interface StoreResponse {
  status: number;
  data: unknown;
}

/**
 * 通用 CRUD 处理。path 已剥掉 /api/<service> 前缀,形如 /<resource> 或 /<resource>/:id。
 */
export function handleStore(
  service: string,
  method: string,
  path: string,
  query: Record<string, string | undefined>,
  body: unknown,
): StoreResponse {
  // /<resource>
  let m = path.match(/^\/([^/]+)$/);
  if (m) {
    const resource = m[1]!;
    if (method === "GET") return listStore(service, resource, query);
    if (method === "POST") return createStore(service, resource, body);
  }
  // /<resource>/:id
  m = path.match(/^\/([^/]+)\/([^/]+)$/);
  if (m) {
    const resource = m[1]!;
    const id = decodeURIComponent(m[2]!);
    if (method === "GET") return getStoreOne(service, resource, id);
    if (method === "PUT") return updateStore(service, resource, id, body);
    if (method === "DELETE") return deleteStore(service, resource, id);
    if (method === "PATCH") return updateStore(service, resource, id, body);
  }
  return { status: 404, data: { error: "not_found", message: `No route ${method} ${path}` } };
}

function listStore(
  service: string,
  resource: string,
  query: Record<string, string | undefined>,
): StoreResponse {
  const store = getStore(service, resource);
  const limit = parseInt(query.limit ?? "10", 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
    return {
      status: 400,
      data: { error: "bad_request", message: "limit must be a positive integer (1-500)" },
    };
  }
  const cursor = query.cursor;
  let start: number;
  if (cursor) {
    start = parseInt(Buffer.from(cursor, "base64").toString(), 10);
    if (!Number.isFinite(start) || start < 0) {
      return { status: 400, data: { error: "bad_request", message: "invalid cursor" } };
    }
  } else {
    start = 0;
  }
  const slice = store.slice(start, start + limit);
  const hasMore = start + limit < store.length;
  const nextCursor = hasMore ? Buffer.from(String(start + limit)).toString("base64") : null;
  return { status: 200, data: { items: slice, hasMore, nextCursor } };
}

function createStore(service: string, resource: string, body: unknown): StoreResponse {
  const store = getStore(service, resource);
  const b = (body ?? {}) as Record<string, unknown>;
  const id = nextId(service, resource);
  const rec: StoreRecord = { id, ...b };
  store.push(rec);
  return { status: 201, data: rec };
}

function getStoreOne(service: string, resource: string, id: string): StoreResponse {
  const store = getStore(service, resource);
  const rec = store.find((r) => r.id === id);
  if (!rec) return { status: 404, data: { error: "not_found", message: `${id} not found` } };
  return { status: 200, data: rec };
}

function updateStore(service: string, resource: string, id: string, body: unknown): StoreResponse {
  const store = getStore(service, resource);
  const idx = store.findIndex((r) => r.id === id);
  if (idx < 0) return { status: 404, data: { error: "not_found", message: `${id} not found` } };
  const b = (body ?? {}) as Record<string, unknown>;
  store[idx] = { ...store[idx]!, ...b, id }; // id 不可改
  return { status: 200, data: store[idx] };
}

function deleteStore(service: string, resource: string, id: string): StoreResponse {
  const store = getStore(service, resource);
  const idx = store.findIndex((r) => r.id === id);
  if (idx < 0) return { status: 404, data: { error: "not_found", message: `${id} not found` } };
  const [removed] = store.splice(idx, 1);
  return { status: 200, data: { deleted: true, id: removed!.id } };
}
