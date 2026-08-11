# Manifest Signing Protocol Specification

This document is the **authoritative specification** of the rxx manifest signing
protocol. The client (`src/manifest/sign.ts`) and the server
(`server/src/sign.ts`) each implement this protocol independently — they do
**not** share code. Both implementations MUST be byte-for-byte consistent with
what this spec describes, otherwise signature verification breaks silently.

When changing either implementation, update this spec first, then change the
code to match. The e2e test suite (`src/__tests__/e2e.test.ts`) guards the
round-trip (server signs → client verifies), but the spec is the canonical
reference reviewers use to catch drift before runtime.

## 1. Cryptographic Algorithm

- **Algorithm**: Ed25519 (`node:crypto` `sign(null, data, privateKey)` /
  `verify(null, data, publicKey, signature)`).
- **Key encoding**:
  - Private key: PKCS#8 PEM.
  - Public key: SPKI DER, carried in the manifest as **base64** (no PEM
    wrapping), and reconstructed to PEM for `createPublicKey`.
- **Signature output**: base64 string.

## 2. Signing Input

The signing input is a SHA-256 digest of a deterministic byte string:

```
signingInput = sha256(
  actualHosts_sorted.join("|") + "\n" +
  declaredHosts_sorted.join("|") + "\n" +
  canonicalJSON(stripSignature(manifest))
)
```

Field-by-field:

| Segment | Definition |
|---|---|
| `actualHosts` | Hosts extracted from the manifest body: `api.baseUrl` and `auth.baseUrl` (see §3). Sorted ascending. Deduplicated (Set). Joined with `\|`. Empty array joins to `""`. |
| `declaredHosts` | Hosts the publisher explicitly passes at sign time (server: the server's own host; stored client-side as `signature.signedHosts`). Sorted ascending. Joined with `\|`. Empty array joins to `""`. |
| `canonicalJSON(...)` | Deterministic JSON serialization (see §4) of the manifest **with the `signature` field removed** (`stripSignature`). |

The three segments are concatenated with `"\n"` (literal newline, 0x0A) between
them. There is no trailing newline after `canonicalJSON`.

### 2.1 Why host binding

`actualHosts` is hashed into the signing input so that **changing
`api.baseUrl` or `auth.baseUrl` after signing invalidates the signature**. This
prevents a signed manifest from being replayed against a different host. The
client recomputes `actualHosts` from the manifest body it received; the server
computes it from the manifest body it is about to serve. If they disagree on
hosts, verification fails.

`declaredHosts` is the publisher's claim of "these are the hosts I signed for".
It is stored verbatim in `signature.signedHosts` so the client can pass the same
value during verification (the client does **not** assert `actualHosts ⊆
declaredHosts`; protection comes from `actualHosts` being hashed).

## 3. Host Extraction (`extractHosts` / `hostOf`)

```
extractHosts(manifest):
  hosts = []
  if manifest.api?.baseUrl: push hostOf(manifest.api.baseUrl)
  if manifest.auth?.baseUrl: push hostOf(manifest.auth.baseUrl)
  return [...new Set(hosts)]   // dedupe, preserves insertion order, NOT sorted here

hostOf(url):
  return new URL(url).host.toLowerCase()   // includes port; throws→null
```

- `URL.host` **includes the port** if present (`example.com:9966`). The port is
  bound into the signature.
- `URL.host` is already lowercased by the URL parser; `.toLowerCase()` is
  belt-and-suspenders.
- Invalid URL → `null` → not pushed.
- `extractHosts` returns deduped but **insertion-ordered** hosts. Sorting
  happens once in `signingInput` (both `actualHosts` and `declaredHosts` are
  `.sort()`-ed before join). The sort is the default string sort (code-unit
  order).

## 4. Canonical JSON (`canonicalize`)

Deterministic serialization so that two semantically-equal manifests produce
identical bytes regardless of key insertion order.

```
canonicalize(value):
  if value is null or not an object: return JSON.stringify(value)
  if value is an array: return "[" + value.map(canonicalize).join(",") + "]"
  // object
  names = Object.getOwnPropertyNames(value)
            .filter(k => k !== "__proto__" && k !== "constructor" && k !== "prototype")
  names.sort()   // default string sort
  return "{" + names.map(k => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}"
```

Properties:

- **Keys are sorted** (default string / code-unit order).
- **No whitespace** between tokens.
- **`Object.getOwnPropertyNames`** is used (not `Object.keys`), so
  non-enumerable own properties are included. In practice manifest JSON has
  only enumerable keys, but this is stricter.
- The dangerous keys `__proto__`, `constructor`, `prototype` are **dropped**
  from the canonical form. They cannot influence the signature (prototype
  pollution resistance).
- Nested objects and arrays are canonicalized recursively.
- `JSON.stringify(k)` quotes the key: `"name"`. The value is the recursive
  result, **not** re-quoted by `JSON.stringify` at the object level (the object
  builder emits `key + ":" + canonicalize(value)` directly).

### 4.1 Edge cases (current behavior, fixed by this spec)

- `undefined` field value: `canonicalize(undefined)` calls `JSON.stringify(undefined)`
  which returns the JS value `undefined` (not a string). When interpolated into
  the object template `${canonicalize(value)}`, it becomes the literal string
  `"undefined"`. This is inconsistent with `JSON.stringify` dropping `undefined`
  in objects, but it is the **defined behavior** of this protocol — both
  implementations do it identically. Manifests SHOULD NOT contain `undefined`
  (they come from JSON, which has no `undefined`).
- `BigInt`: would throw; caught by `verifyManifest`'s try/catch → verification
  returns `false`. Manifests MUST NOT contain BigInt.
- Numbers: `JSON.stringify` handles them (`NaN`/`Infinity` → `null`).

## 5. `stripSignature`

Before canonicalizing, the `signature` key is removed from the manifest object.
The signature is computed over the **unsigned body**, so the signature value
does not hash itself (circular dependency).

```
stripSignature(manifest):
  const { signature, ...rest } = manifest
  return rest
```

Note: at sign time the server passes a manifest that may contain a partial
`signature: { publicKey }` block (used to carry the public key into the served
manifest). `stripSignature` removes the entire `signature` key regardless of
its contents, so the partial block does not affect the signing input. Both
client and server strip identically.

## 6. Public Key Fingerprint

For human verification ("is this the key I trust?"):

```
keyFingerprint(publicKeyPemOrBase64):
  pem = startsWith(publicKeyPemOrBase64, "-----BEGIN") ? publicKeyPemOrBase64 : base64ToPem(publicKeyPemOrBase64)
  der = createPublicKey(pem).export({ type: "spki", format: "der" })
  return "sha256:" + sha256(der).hex()
```

Format: `sha256:` + lowercase hex of the SHA-256 of the SPKI DER bytes. This is
**not** part of the signing input; it is a separate identifier stored in
`signature.keyFingerprint` for display and pinning.

## 7. `signature` Object Shape

```jsonc
{
  "signature": {
    "publicKey": "<base64 SPKI DER>",
    "keyFingerprint": "sha256:<hex>",
    "signedAt": "<ISO 8601>",
    "signedHosts": ["example.com:9966"],   // === declaredHosts at sign time
    "signature": "<base64 Ed25519 signature>"
  }
}
```

- `publicKey`: base64 (no PEM wrapping) of the SPKI DER. Used by the client to
  reconstruct the PEM via `base64ToPem` (64-char lines wrapped in
  `-----BEGIN/END PUBLIC KEY-----`).
- `signedHosts`: the `declaredHosts` the publisher passed at sign time. The
  client reads this and passes it back as `declaredHosts` during verification.
- `signedAt`: informational timestamp; **not** part of the signing input. (No
  expiry is currently enforced.)
- `signature`: the base64 Ed25519 signature over `signingInput`.

## 8. Verification (`verifyManifest`)

```
verifyManifest(manifest, trustedPublicKeyPem?):
  sig = manifest.signature?.signature
  pubB64 = manifest.signature?.publicKey
  if !sig || !pubB64: return false
  try:
    pubKeyPem = trustedPublicKeyPem ?? base64ToPem(pubB64)
    publicKey = createPublicKey(pubKeyPem)
    declaredHosts = manifest.signature?.signedHosts ?? []
    return verify(null, signingInput(manifest, declaredHosts), publicKey, Buffer.from(sig, "base64"))
  catch:
    return false
```

- If `trustedPublicKeyPem` is provided (TOFU pinning: the client cached the
  publisher's key on first install), it overrides the manifest's `publicKey`.
  This is how the client detects a key change: the pinned key fails to verify a
  manifest signed by a different key.
- Any exception (bad PEM, bad base64, BigInt in body, etc.) → `false`.

## 9. Test Contract

The round-trip is guarded by:

- `src/__tests__/sign.test.ts` — client-side sign/verify, tamper detection
  (body change, host change), pinning precedence.
- `src/__tests__/e2e.test.ts` — server signs real manifests, client fetches and
  verifies end-to-end.

If you change either implementation, both suites MUST stay green. If you change
the protocol itself (e.g. the join delimiter, the canonicalization rules),
update this spec AND both implementations AND the tests in the same change.
