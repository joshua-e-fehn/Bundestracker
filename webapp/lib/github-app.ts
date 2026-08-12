/**
 * GitHub App credentials: reading them, and turning them into a signed JWT.
 *
 * The feedback publisher authenticates to GitHub as a **GitHub App
 * installation** rather than as a person holding a fine-grained PAT. The
 * difference that matters operationally is that an installation token is minted
 * on demand and expires in an hour, so there is no long-lived secret to rotate
 * and nothing to babysit; the difference that matters in the issue tracker is
 * attribution, since a report then arrives from the app rather than from
 * whoever's account happened to mint the token.
 *
 * ## Everything here is pure, and that is the point
 *
 * This module reads no environment and performs no request. It takes strings
 * and returns strings, so every branch — a malformed key, an escaped-newline
 * key, a key of the wrong type — is reachable from a unit test with a throwaway
 * RSA key generated for the purpose. `convex/lib/githubToken.ts` is the impure half
 * that reads `process.env` and calls GitHub, and it is deliberately thin.
 *
 * ## ⚠ The private key never leaves this module in any form
 *
 * `appJwt` takes the PEM and returns a JWT. Nothing here returns the key, the
 * DER, or the imported `CryptoKey`, and nothing here throws an error carrying
 * key material — every failure is a fixed string from `CredentialProblem`,
 * chosen so an operator can tell *which* variable is wrong without the message
 * ever quoting what was in it. That rule is asserted by
 * lib/github-app.test.ts and by lib/feedback-boundaries.test.ts.
 *
 * ## Why the DER is assembled by hand
 *
 * GitHub issues App private keys in **PKCS#1** (`-----BEGIN RSA PRIVATE
 * KEY-----`). `crypto.subtle.importKey` accepts only **PKCS#8**
 * (`-----BEGIN PRIVATE KEY-----`), and the Convex V8 runtime has no `node:crypto`
 * to convert with — an action could declare `"use node"`, but convex/feedback.ts
 * cannot, and splitting the publisher across two runtimes to reach one function
 * would be a much larger change than the twenty bytes of header this needs.
 *
 * A PKCS#8 wrapper around a PKCS#1 key is a fixed prefix: the version, the
 * rsaEncryption algorithm identifier, and an OCTET STRING holding the original
 * key. `wrapPkcs1AsPkcs8` writes exactly that. It is verified in
 * lib/github-app.test.ts against signatures checked with the matching public
 * key, which is the only assertion that actually proves the bytes are right —
 * a wrong wrapper can still produce plausible-looking output.
 */

/** What is wrong with an operator's credentials. Never the value itself. */
export type CredentialProblem =
  | "app-id-missing"
  | "app-id-invalid"
  | "installation-id-missing"
  | "installation-id-invalid"
  | "private-key-missing"
  | "private-key-unparseable"
  | "private-key-wrong-type"

/** A GitHub App's three operator-supplied inputs, validated. */
export type AppCredentials = {
  appId: string
  installationId: string
  /** The PEM exactly as the operator supplied it. Normalised at signing time
   * rather than stored decoded, so no decoded form of the key is held in a
   * value that could be logged by accident. */
  privateKeyPem: string
}

/**
 * The PEM encodings an operator can plausibly paste into a secret store.
 *
 * All three occur in practice and the difference is invisible in a dashboard:
 *
 *  - **canonical** — real newlines, as `openssl` writes and as GitHub downloads.
 *  - **escaped** — `\n` as two characters, which is what happens when the key
 *    goes through a JSON field, a `.env` file, or a CI secret editor that
 *    escapes on save.
 *  - **collapsed** — every run of whitespace flattened to single spaces, which
 *    is what a form field or a shell that ate the newlines produces. This is the
 *    form the operator for this deployment actually has.
 *
 * Accepting all three is not laxity: the bytes are identical in every case, and
 * the alternative is an operator whose key is cryptographically perfect being
 * told only that authentication failed.
 */
const PEM_BLOCK =
  /-{3,}\s*BEGIN\s+([A-Z][A-Z ]*[A-Z])\s*-{3,}([\sA-Za-z0-9+/=\\]*?)-{3,}\s*END\s+([A-Z][A-Z ]*[A-Z])\s*-{3,}/

/** A decoded PEM: what kind of key it is, and its DER bytes. */
type ParsedPem = { label: string; der: Uint8Array }

/**
 * Decodes a PEM in any of the three encodings above.
 *
 * Returns `null` rather than throwing for every malformed input, so the caller
 * has one branch for "this is not a usable key" instead of a try/catch around a
 * value that must not appear in the error.
 */
export function parsePem(raw: string): ParsedPem | null {
  if (!raw) return null
  // Escaped forms first: `\n` as two characters becomes a newline, and a
  // stray `\r` is dropped rather than becoming whitespace inside the base64.
  const unescaped = raw.replace(/\\r/g, "").replace(/\\n/g, "\n")
  const match = PEM_BLOCK.exec(unescaped)
  if (!match) return null

  // The BEGIN and END labels must agree. A block that opens as one kind of key
  // and closes as another is truncated or spliced, not merely oddly formatted.
  const label = match[1].replace(/\s+/g, " ").trim()
  if (label !== match[3].replace(/\s+/g, " ").trim()) return null

  // Whitespace *inside* the body is meaningless in PEM — this is what makes the
  // collapsed form decode identically to the canonical one.
  const body = match[2].replace(/\s+/g, "")
  if (body.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null

  try {
    return { label, der: base64ToBytes(body) }
  } catch {
    return null
  }
}

/** DER's length encoding: short form under 128, long form above it. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length]
  const bytes: number[] = []
  for (let value = length; value > 0; value >>= 8) bytes.unshift(value & 0xff)
  return [0x80 | bytes.length, ...bytes]
}

/**
 * `PrivateKeyInfo ::= SEQUENCE { version INTEGER, algorithm AlgorithmIdentifier,
 * privateKey OCTET STRING }` — RFC 5208 §5, with the PKCS#1 key as the payload.
 *
 * The algorithm identifier is the constant OID 1.2.840.113549.1.1.1
 * (rsaEncryption) followed by NULL parameters, which is why it can be a literal:
 * for an RSA key it is always these fifteen bytes.
 */
function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00]
  const rsaEncryption = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]
  const octetHeader = [0x04, ...derLength(pkcs1.length)]
  const contentLength = version.length + rsaEncryption.length + octetHeader.length + pkcs1.length
  const header = [0x30, ...derLength(contentLength)]

  const out = new Uint8Array(header.length + contentLength)
  let at = 0
  for (const byte of [...header, ...version, ...rsaEncryption, ...octetHeader]) out[at++] = byte
  out.set(pkcs1, at)
  return out
}

/**
 * Validates the three operator inputs without deciding whether the key *works*.
 *
 * Shape only: that the ids are positive integers and that the PEM decodes to
 * something of the right type. Whether the key is the one GitHub holds is not
 * knowable here and is not guessed at — that answer comes from GitHub rejecting
 * the JWT, and the caller reports it as such.
 *
 * The ids are checked against `^\d+$` rather than parsed, because `Number("12a")`
 * is `NaN` but `parseInt("12a")` is `12` — an id with a stray character would
 * otherwise silently become a different, valid-looking id.
 */
export function readCredentials(input: {
  appId: string | undefined
  installationId: string | undefined
  privateKey: string | undefined
}): { credentials: AppCredentials } | { problem: CredentialProblem } {
  const appId = (input.appId ?? "").trim()
  if (!appId) return { problem: "app-id-missing" }
  if (!/^\d+$/.test(appId)) return { problem: "app-id-invalid" }

  const installationId = (input.installationId ?? "").trim()
  if (!installationId) return { problem: "installation-id-missing" }
  if (!/^\d+$/.test(installationId)) return { problem: "installation-id-invalid" }

  const privateKeyPem = input.privateKey ?? ""
  if (!privateKeyPem.trim()) return { problem: "private-key-missing" }

  const parsed = parsePem(privateKeyPem)
  if (!parsed) return { problem: "private-key-unparseable" }
  // A public key or a certificate pasted in place of the private key is a
  // distinct mistake from a corrupted one, and worth saying so: both are
  // "BEGIN … KEY" blocks and an operator can easily copy the wrong file.
  if (parsed.label !== "RSA PRIVATE KEY" && parsed.label !== "PRIVATE KEY") {
    return { problem: "private-key-wrong-type" }
  }

  return { credentials: { appId, installationId, privateKeyPem } }
}

/**
 * How long an app JWT is valid for.
 *
 * GitHub rejects anything over ten minutes. Nine leaves a minute of headroom,
 * and the JWT is used immediately to mint an installation token rather than
 * being held, so its lifetime is a bound on clock skew rather than a cache
 * window — the caching that matters is of the *installation token*, in
 * convex/lib/githubToken.ts.
 */
const JWT_TTL_SECONDS = 9 * 60

/**
 * Backdating on `iat`.
 *
 * GitHub's own documentation recommends it: the deployment's clock and
 * GitHub's can disagree by a few seconds, and a JWT whose `iat` is in the
 * future is rejected outright. Sixty seconds is what GitHub suggests.
 */
const CLOCK_SKEW_SECONDS = 60

/**
 * A signed app JWT — the credential that buys an installation token.
 *
 * `nowMs` is a parameter rather than a call to `Date.now()` so the claims are
 * assertable: a test can sign at a fixed instant and decode the payload to check
 * `iat`, `exp` and `iss` exactly, which is the only way to catch a backdating or
 * TTL error before GitHub does.
 *
 * Throws `CredentialProblem` as a plain `Error` message when the key cannot be
 * imported — the message is one of the fixed strings above and never contains
 * key material.
 */
export async function appJwt(credentials: AppCredentials, nowMs: number): Promise<string> {
  const key = await importPrivateKey(credentials.privateKeyPem)
  const issuedAt = Math.floor(nowMs / 1000) - CLOCK_SKEW_SECONDS

  const signingInput = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({
      iat: issuedAt,
      exp: issuedAt + CLOCK_SKEW_SECONDS + JWT_TTL_SECONDS,
      iss: credentials.appId,
    }),
  )}`

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

/**
 * The PEM as a signing key.
 *
 * PKCS#1 is wrapped into PKCS#8 first; a key already in PKCS#8 is imported as
 * it stands. `false` for `extractable` is deliberate and is the one line that
 * makes the "never leaves this module" claim structural rather than a
 * convention: the runtime itself will refuse to export the key material, so no
 * future edit here can serialise it by accident.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const parsed = parsePem(pem)
  if (!parsed) throw new Error("private-key-unparseable")

  const pkcs8 =
    parsed.label === "RSA PRIVATE KEY"
      ? wrapPkcs1AsPkcs8(parsed.der)
      : parsed.label === "PRIVATE KEY"
        ? parsed.der
        : null
  if (!pkcs8) throw new Error("private-key-wrong-type")

  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      // A fresh buffer: `parsed.der` may be a view into a larger allocation, and
      // `importKey` reads the whole underlying buffer rather than the view.
      pkcs8.slice().buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    )
  } catch {
    // Structurally valid DER that is not in fact an RSA key. Deliberately not
    // re-thrown: the underlying error can quote the input.
    throw new Error("private-key-unparseable")
  }
}

// --- encodings ------------------------------------------------------------

/** Base64 → bytes. Throws on invalid input, which `parsePem` catches. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Bytes or text → base64url, which is what a JWT's three parts are. */
function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
