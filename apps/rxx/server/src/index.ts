#!/usr/bin/env node
/**
 * rxx-server —— manifest 托管 + mock SaaS 服务器
 *
 * 纯 node http(不引外部框架),两个职责:
 *   1. GET /manifests/<name>  → 返回签名后的 manifest
 *   2. /api/*                  → mock SaaS(orders/products)
 *
 * 启动:
 *   node dist/index.js [--port 9966] [--host 127.0.0.1]
 *
 * 测试 rxx 客户端:
 *   cxx init http://127.0.0.1:9966/manifests/demo-orders --insecure --private-endpoints --yes
 *   cxx run demo-orders orders list --limit 3
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadOrCreateKeys, signManifest } from "./sign.js";
import { buildManifests } from "./manifests.js";
import { handleSaas } from "./saas.js";
import { handleStore, seedStore, type StoreRecord } from "./store.js";

// 动态注册的服务(运行时 POST /__admin/manifests 加,不在 buildManifests 里)
// service name → manifest(含 baseUrl 等)
const dynamicServices = new Map<string, any>();
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

const PORT = parseInt(process.env.PORT ?? "9966", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
// admin 端点 token(防开放签名 oracle;生产部署必设,本地测试可不设)
const ADMIN_TOKEN = process.env.RXX_ADMIN_TOKEN;

async function main() {
  const keys = loadOrCreateKeys();
  const port = PORT;
  const baseUrl = `http://${HOST}:${port}`;

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res, keys, baseUrl);
    } catch (err) {
      sendJson(res, 500, { error: "internal", message: (err as Error).message });
    }
  });

  server.listen(port, HOST, () => {
    process.stderr.write(`\nrxx-server listening on ${baseUrl}\n`);
    process.stderr.write(`  public key fingerprint: ${keys.fingerprint}\n\n`);
    process.stderr.write(`Manifests:\n`);
    for (const name of Object.keys(buildManifests(baseUrl))) {
      process.stderr.write(`  ${baseUrl}/manifests/${name}\n`);
    }
    process.stderr.write(
      `\nMock SaaS API:\n  ${baseUrl}/api/orders\n  ${baseUrl}/api/products\n\n`,
    );
    process.stderr.write(
      `Test:\n  rxx init ${baseUrl}/manifests/demo-orders --insecure --private-endpoints --yes\n  rxx run demo-orders orders list --limit 3\n\n`,
    );
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  keys: ReturnType<typeof loadOrCreateKeys>,
  baseUrl: string,
) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();

  // —— CORS(本地开发,收紧到 localhost/127.0.0.1 origin,非通配 *)——
  const origin = req.headers.origin;
  const allowedOrigins = [
    "http://localhost:9966",
    "http://127.0.0.1:9966",
    `http://${HOST}:${PORT}`,
  ];
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // —— /__admin/* 端点鉴权(防开放签名 oracle)——
  if (path.startsWith("/__admin/")) {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (ADMIN_TOKEN && token !== ADMIN_TOKEN) {
      sendJson(res, 403, {
        error: "forbidden",
        message: "admin token required (set RXX_ADMIN_TOKEN)",
      });
      return;
    }
  }

  // —— /manifests/<name> ——(含动态注册的)
  let m = path.match(/^\/manifests\/([^/]+)$/);
  if (m && method === "GET") {
    const name = decodeURIComponent(m[1]!);
    const staticManifests = buildManifests(baseUrl);
    const manifest = staticManifests[name] ?? dynamicServices.get(name);
    if (!manifest) {
      sendJson(res, 404, { error: "not_found", message: `No manifest named "${name}"` });
      return;
    }
    // 签名(动态服务也要签,客户端才能验签)
    const hosts = [hostOf(baseUrl)].filter(Boolean) as string[];
    const signedManifest = {
      ...manifest,
      signature: {
        publicKey: keys.publicKeyBase64,
        keyFingerprint: keys.fingerprint,
        signedAt: new Date().toISOString(),
        signedHosts: hosts,
        signature: signManifest(
          { ...manifest, signature: { publicKey: keys.publicKeyBase64 } },
          keys.privateKeyPem,
          hosts, // declaredHosts 显式传入(C10)
        ),
      },
    };
    sendJson(res, 200, signedManifest);
    return;
  }

  // —— /__admin/raw-manifest(注入任意 manifest,测试坏配置用,不签名)——
  if (path === "/__admin/raw-manifest" && method === "POST") {
    const text = await readBody(req);
    let spec: any;
    try {
      spec = JSON.parse(text);
    } catch {
      sendJson(res, 400, { error: "bad_request", message: "invalid JSON body" });
      return;
    }
    // spec: { name, manifest, sign?: boolean }
    const name = spec.name;
    if (!name) {
      sendJson(res, 400, { error: "bad_request", message: "spec.name required" });
      return;
    }
    let manifest = spec.manifest;
    // 可选签名(sign:false 用于测未签名场景;默认签)
    if (spec.sign !== false) {
      const hosts = [hostOf(baseUrl)].filter(Boolean) as string[];
      manifest = {
        ...manifest,
        signature: {
          publicKey: keys.publicKeyBase64,
          keyFingerprint: keys.fingerprint,
          signedAt: new Date().toISOString(),
          signedHosts: hosts,
          signature: signManifest(
            { ...manifest, signature: { publicKey: keys.publicKeyBase64 } },
            keys.privateKeyPem,
          ),
        },
      };
    }
    dynamicServices.set(name, manifest);
    sendJson(res, 201, {
      registered: true,
      service: name,
      manifestUrl: `${baseUrl}/manifests/${name}`,
    });
    return;
  }

  // —— /__admin/manifests(动态注册端点,仅测试/演示用)——
  if (path === "/__admin/manifests" && method === "POST") {
    const text = await readBody(req);
    let spec: any;
    try {
      spec = JSON.parse(text);
    } catch {
      sendJson(res, 400, { error: "bad_request", message: "invalid JSON body" });
      return;
    }
    // spec: { service, description, version?, resources: { name: { description, fields, seed } } }
    const serviceName = spec.service;
    if (!serviceName) {
      sendJson(res, 400, { error: "bad_request", message: "spec.service required" });
      return;
    }
    // 构造 manifest(通用 store 路由)+ seed 数据
    const namespaces: Record<string, any> = {};
    for (const [resourceName, rdef] of Object.entries<any>(spec.resources ?? {})) {
      // 通用:list / get / create / update / delete
      namespaces[resourceName] = {
        list: {
          description: rdef.description ?? `list ${resourceName}`,
          args: {
            limit: { type: "number", desc: "每页数量" },
            cursor: { type: "string", desc: "续拉游标" },
          },
          http: {
            method: "GET",
            path: `/api/${serviceName}/${resourceName}`,
            query: { limit: "{limit}", cursor: "{cursor}" },
          },
          response: {
            data: "items",
            pagination: {
              complete: { field: "hasMore", invert: true },
              nextToken: { field: "nextCursor" },
            },
          },
        },
        get: {
          description: `get one ${resourceName}`,
          args: { id: { type: "string", required: true, positional: true, desc: "ID" } },
          http: { method: "GET", path: `/api/${serviceName}/${resourceName}/{id}` },
          response: { data: "." },
        },
        create: {
          description: `create ${resourceName}`,
          args: Object.fromEntries(
            Object.entries<any>(rdef.fields ?? {}).map(([k, v]) => [
              k,
              { type: v.type ?? "string", required: v.required ?? false, desc: v.desc ?? k },
            ]),
          ),
          http: {
            method: "POST",
            path: `/api/${serviceName}/${resourceName}`,
            body: Object.fromEntries(Object.keys(rdef.fields ?? {}).map((k) => [k, `{${k}}`])),
          },
          response: { data: "." },
        },
      };
      // seed 初始数据
      if (Array.isArray(rdef.seed)) {
        seedStore(serviceName, resourceName, rdef.seed as StoreRecord[]);
      }
    }
    const manifest = {
      name: serviceName,
      description: spec.description ?? `dynamic service ${serviceName}`,
      version: spec.version ?? "1.0.0",
      api: { baseUrl },
      errorOnStatus: { "404": "not_found", "5xx": "server_error" },
      namespaces,
    };
    dynamicServices.set(serviceName, manifest);
    sendJson(res, 201, {
      registered: true,
      service: serviceName,
      manifestUrl: `${baseUrl}/manifests/${serviceName}`,
    });
    return;
  }

  // —— /api/* → mock SaaS ——
  if (path.startsWith("/api/")) {
    const rest = path.slice(4); // 去掉 /api
    const query: Record<string, string | undefined> = {};
    for (const [k, v] of url.searchParams.entries()) query[k] = v;
    let body: unknown = undefined;
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const text = await readBody(req);
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        sendJson(res, 400, { error: "bad_request", message: "invalid JSON body" });
        return;
      }
    }
    // 动态服务分发: /api/<service>/<resource>... → handleStore
    const sm = rest.match(/^\/([^/]+)(\/.*)?$/);
    if (sm && dynamicServices.has(sm[1]!)) {
      const dynService = sm[1]!;
      const dynPath = sm[2] ?? "";
      const result = handleStore(dynService, method, dynPath, query, body);
      sendJson(res, result.status, result.data);
      return;
    }
    // 静态服务(demo-orders/demo-products)
    const result = handleSaas(method, rest, query, body);
    sendJson(res, result.status, result.data);
    return;
  }

  // —— / —— index
  if (path === "/" && method === "GET") {
    sendJson(res, 200, {
      service: "rxx-server",
      manifests: Object.keys(buildManifests(baseUrl)).map((n) => `${baseUrl}/manifests/${n}`),
      api: [`${baseUrl}/api/orders`, `${baseUrl}/api/products`],
    });
    return;
  }

  sendJson(res, 404, { error: "not_found", message: `${method} ${path}` });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      data += chunk;
      if (data.length > 1_000_000) {
        rejected = true;
        // 消费剩余流防连接挂起,然后 reject
        req.resume();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => {
      if (!rejected) resolve(data);
    });
    req.on("error", (e) => {
      if (!rejected) reject(e);
    });
  });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
