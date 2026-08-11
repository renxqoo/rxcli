/**
 * rxx-server —— 托管的 manifest 定义
 *
 * 服务器启动时根据当前端口动态生成 manifest(baseUrl 含端口),
 * 用私钥签名后暴露在 /manifests/<name> 端点。
 *
 * 两个 demo 服务:
 *   - demo-orders:orders CRUD(标准分页结构 hasMore/nextCursor)
 *   - demo-products:products(异构分页 paging.next,测 response 映射)
 */

// manifest 的最小类型子集(避免跨目录引用 rxx src,server 独立)
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface ManifestCommand {
  description: string;
  args?: Record<string, any>;
  http: {
    method: HttpMethod;
    path: string;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
  };
  response: { data: string; pagination?: any; meta?: Record<string, string> };
}
type ManifestCommandGroup = Record<string, ManifestCommand>;
interface Manifest {
  name: string;
  description: string;
  version: string;
  minCliVersion?: string;
  api: { baseUrl: string };
  errorOnStatus?: Record<string, string>;
  namespaces?: Record<string, ManifestCommandGroup>;
  signature?: Record<string, unknown>;
}

/** 根据服务器端口生成 manifest(baseUrl 含端口)。 */
export function buildManifests(baseUrl: string): Record<string, Manifest> {
  return {
    "demo-orders": {
      name: "demo-orders",
      description: "演示订单服务(orders CRUD + 标准分页)",
      version: "1.0.0",
      minCliVersion: "0.1.0",
      api: { baseUrl },
      errorOnStatus: {
        "401": "token_expired",
        "403": "forbidden",
        "404": "not_found",
        "5xx": "server_error",
      },
      namespaces: {
        orders: {
          list: {
            description: "查询订单列表(分页)",
            args: {
              limit: { type: "number", min: 1, max: 100, desc: "每页数量(默认 10)" },
              cursor: { type: "string", desc: "续拉游标(用上次 meta.pagination.next_token)" },
            },
            http: {
              method: "GET",
              path: "/api/orders",
              query: { limit: "{limit}", cursor: "{cursor}" },
            },
            response: {
              data: "orders",
              pagination: {
                complete: { field: "hasMore", invert: true },
                nextToken: { field: "nextCursor" },
              },
            },
          },
          get: {
            description: "查询单个订单详情",
            args: {
              id: { type: "string", required: true, positional: true, desc: "订单 ID(如 ord_001)" },
            },
            http: { method: "GET", path: "/api/orders/{id}" },
            response: { data: "." },
          },
          create: {
            description: "创建订单",
            args: {
              amount: { type: "number", required: true, desc: "金额(分)" },
              customer: { type: "string", required: true, desc: "客户标识" },
            },
            http: {
              method: "POST",
              path: "/api/orders",
              body: { amount: "{amount}", customer: "{customer}" },
            },
            response: { data: "." },
          },
        },
      },
    },

    "demo-products": {
      name: "demo-products",
      description: "演示商品服务(异构分页 paging.next,测 response 映射)",
      version: "1.0.0",
      api: { baseUrl },
      errorOnStatus: { "404": "not_found", "5xx": "server_error" },
      namespaces: {
        products: {
          list: {
            description: "查询商品列表",
            args: {
              limit: { type: "number", min: 1, max: 100, desc: "每页数量" },
              cursor: { type: "string", desc: "续拉游标" },
            },
            http: {
              method: "GET",
              path: "/api/products",
              query: { limit: "{limit}", cursor: "{cursor}" },
            },
            // 异构分页:res.data.data.items + res.data.paging.next
            response: {
              data: "data.items",
              pagination: {
                complete: { field: "paging.next", invert: true },
                nextToken: { field: "paging.next" },
              },
            },
          },
          get: {
            description: "查询单个商品详情",
            args: {
              id: {
                type: "string",
                required: true,
                positional: true,
                desc: "商品 ID(如 prod_001)",
              },
            },
            http: { method: "GET", path: "/api/products/{id}" },
            response: { data: "." },
          },
        },
      },
    },
  };
}
