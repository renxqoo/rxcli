/**
 * rxx-server —— mock SaaS 内存数据 + 接口处理
 *
 * 提供两个服务的 mock 接口,供动态命令调用:
 *   /api/orders      GET 列表(带分页)/ POST 创建
 *   /api/orders/:id  GET 详情 / PUT 更新 / DELETE 删除
 *   /api/products    GET 列表 / POST 创建
 *
 * 响应结构刻意异构(模拟真实 SaaS),让 manifest 的 response 映射有活干:
 *   orders: { orders: [...], hasMore: bool, nextCursor: string|null }
 *   products: { data: { items: [...] }, paging: { next: string|null } }
 */

export interface Order {
  id: string;
  status: "pending" | "paid" | "shipped" | "cancelled";
  amount: number;
  customer: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

// —— 内存数据(启动时填充)——
const orders: Order[] = Array.from({ length: 25 }, (_, i) => ({
  id: `ord_${String(i + 1).padStart(3, "0")}`,
  status: (["pending", "paid", "shipped", "cancelled"] as const)[i % 4]!,
  amount: 1000 + i * 500,
  customer: `customer_${(i % 5) + 1}`,
  createdAt: new Date(Date.now() - i * 86400000).toISOString(),
}));

const products: Product[] = [
  { id: "prod_001", name: "Widget", price: 990, stock: 100, category: "tools" },
  { id: "prod_002", name: "Gadget", price: 2900, stock: 50, category: "electronics" },
  { id: "prod_003", name: "Sprocket", price: 150, stock: 500, category: "tools" },
  { id: "prod_004", name: "Gizmo", price: 4999, stock: 10, category: "electronics" },
  { id: "prod_005", name: "Doohickey", price: 750, stock: 200, category: "misc" },
];
// 已分配的最大序号(防删后再创建 ID 碰撞:用递增 counter 而非 length+1)
let orderSeq = orders.length;
let productSeq = products.length;

export interface SaasResponse {
  status: number;
  data: unknown;
}

/** 处理 mock SaaS 请求。path 已剥掉 /api 前缀。 */
export function handleSaas(
  method: string,
  path: string,
  query: Record<string, string | undefined>,
  body: unknown,
): SaasResponse {
  // /orders
  let m = path.match(/^\/orders$/);
  if (m) {
    if (method === "GET") return listOrders(query);
    if (method === "POST") return createOrder(body);
  }
  // /orders/:id
  m = path.match(/^\/orders\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    if (method === "GET") return getOrder(id);
    if (method === "PUT") return updateOrder(id, body);
    if (method === "DELETE") return deleteOrder(id);
  }
  // /products
  m = path.match(/^\/products$/);
  if (m) {
    if (method === "GET") return listProducts(query);
    if (method === "POST") return createProduct(body);
  }
  // /products/:id
  m = path.match(/^\/products\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    if (method === "GET") return getProduct(id);
  }
  return { status: 404, data: { error: "not_found", message: `No route for ${method} ${path}` } };
}

function listOrders(query: Record<string, string | undefined>): SaasResponse {
  const limit = parseInt(query.limit ?? "10", 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
    return {
      status: 400,
      data: { error: "bad_request", message: "limit must be a positive integer (1-500)" },
    };
  }
  const cursor = query.cursor; // base64 page index
  let start: number;
  if (cursor) {
    start = parseInt(Buffer.from(cursor, "base64").toString(), 10);
    if (!Number.isFinite(start) || start < 0) {
      return { status: 400, data: { error: "bad_request", message: "invalid cursor" } };
    }
  } else {
    start = 0;
  }
  const slice = orders.slice(start, start + limit);
  const hasMore = start + limit < orders.length;
  const nextCursor = hasMore ? Buffer.from(String(start + limit)).toString("base64") : null;
  return {
    status: 200,
    data: { orders: slice, hasMore, nextCursor },
  };
}

function createOrder(body: unknown): SaasResponse {
  const b = (body ?? {}) as Record<string, unknown>;
  orderSeq += 1;
  const id = `ord_${String(orderSeq).padStart(3, "0")}`;
  const order: Order = {
    id,
    status: "pending",
    amount: Number(b.amount ?? 0),
    customer: String(b.customer ?? "unknown"),
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  return { status: 201, data: order };
}

function getOrder(id: string): SaasResponse {
  const order = orders.find((o) => o.id === id);
  if (!order)
    return { status: 404, data: { error: "not_found", message: `Order ${id} not found` } };
  return { status: 200, data: order };
}

function updateOrder(id: string, body: unknown): SaasResponse {
  const idx = orders.findIndex((o) => o.id === id);
  if (idx < 0)
    return { status: 404, data: { error: "not_found", message: `Order ${id} not found` } };
  const b = (body ?? {}) as Record<string, unknown>;
  orders[idx] = { ...orders[idx]!, ...b } as Order;
  return { status: 200, data: orders[idx] };
}

function deleteOrder(id: string): SaasResponse {
  const idx = orders.findIndex((o) => o.id === id);
  if (idx < 0)
    return { status: 404, data: { error: "not_found", message: `Order ${id} not found` } };
  const removed = orders.splice(idx, 1)[0]!;
  return { status: 200, data: { deleted: true, id: removed.id } };
}

function listProducts(query: Record<string, string | undefined>): SaasResponse {
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
  const slice = products.slice(start, start + limit);
  const hasNext = start + limit < products.length;
  // 刻意用不同的分页结构(paging.next),模拟异构 SaaS
  return {
    status: 200,
    data: {
      data: { items: slice },
      paging: { next: hasNext ? Buffer.from(String(start + limit)).toString("base64") : null },
    },
  };
}

function createProduct(body: unknown): SaasResponse {
  const b = (body ?? {}) as Record<string, unknown>;
  productSeq += 1;
  const id = `prod_${String(productSeq).padStart(3, "0")}`;
  const product: Product = {
    id,
    name: String(b.name ?? "unnamed"),
    price: Number(b.price ?? 0),
    stock: Number(b.stock ?? 0),
    category: String(b.category ?? "misc"),
  };
  products.push(product);
  return { status: 201, data: product };
}

function getProduct(id: string): SaasResponse {
  const product = products.find((p) => p.id === id);
  if (!product)
    return { status: 404, data: { error: "not_found", message: `Product ${id} not found` } };
  return { status: 200, data: product };
}
