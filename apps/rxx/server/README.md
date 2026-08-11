# rxx-server

Manifest host + mock SaaS for `rxx` local development, demos, and end-to-end tests.

This server is **not published** (`private: true`). It exists to:
1. Host signed manifests for the `rxx` client to fetch.
2. Provide a mock SaaS API (orders/products) for dynamic commands to call.
3. Support dynamic service registration at runtime (to test "zero-code client updates").

## Run

```bash
pnpm --filter @renxqoo/rxx-server build
node dist/index.js            # http://127.0.0.1:9966
# PORT=8080 node dist/index.js   # custom port
# HOST=0.0.0.0 node dist/index.js
```

On first start, an Ed25519 key pair is generated in `keys/` (gitignored) and used to sign all served manifests.

## Endpoints

### Manifests (signed)
- `GET /manifests/demo-orders` — orders CRUD manifest (standard pagination)
- `GET /manifests/demo-products` — products manifest (heterogeneous pagination, tests response mapping)

### Mock SaaS
- `GET/POST /api/orders` — orders list (paginated) / create
- `GET/PUT/DELETE /api/orders/:id` — single order
- `GET/POST /api/products` — products list (paginated) / create
- `GET /api/products/:id` — single product

### Dynamic registration (admin, test-only)
- `POST /__admin/manifests` — register a new service from a spec (auto-generates list/get/create commands + seeds data). Body: `{ service, description, resources: { name: { fields, seed } } }`
- `POST /__admin/raw-manifest` — inject an arbitrary manifest (for testing bad-config handling). Body: `{ name, manifest, sign?: boolean }`

## Testing the client

```bash
# start this server, then in another terminal:
rxx init http://127.0.0.1:9966/manifests/demo-orders --insecure --private-endpoints --yes
rxx run demo-orders orders list --limit 3
```

The `--insecure --private-endpoints` flags are required because this server runs on HTTP localhost (production manifests should be HTTPS + public host).
