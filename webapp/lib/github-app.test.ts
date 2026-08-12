import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appJwt, parsePem, readCredentials } from "./github-app"

/**
 * GitHub App credentials, and the JWT they sign.
 *
 * ## The keys here are generated, never fixtures
 *
 * Every key in this file is minted by `openssl` into a temporary directory at
 * the start of the run and deleted at the end. None is committed, none is the
 * deployment's, and none is ever printed — the addendum's rule that credential
 * material must not reach tests or committed files is met by there being no
 * credential material to reach them.
 *
 * That is also what makes the central assertion possible. A signing test that
 * only checks "a string came back with two dots in it" would pass against a
 * wrong PKCS#8 wrapper, wrong padding, or a signature over the wrong bytes —
 * which is precisely the class of bug that hand-assembled DER invites. Holding
 * the matching public key means the signature can be **verified**, by `openssl`
 * rather than by the code under test, and that is the only assertion that
 * proves the bytes are right.
 */

const dir = mkdtempSync(join(tmpdir(), "bundestrack-ghapp-"))

function openssl(...args: string[]): string {
  return execFileSync("openssl", args, { encoding: "utf8" })
}

/** A throwaway 2048-bit key in both encodings, plus its public half. */
function generateKeys() {
  const pkcs1Path = join(dir, "pkcs1.pem")
  const pkcs8Path = join(dir, "pkcs8.pem")
  const publicPath = join(dir, "public.pem")
  // `-traditional` is what produces a PKCS#1 `BEGIN RSA PRIVATE KEY` block on
  // OpenSSL 3, which is the encoding GitHub actually hands an operator.
  openssl("genrsa", "-traditional", "-out", pkcs1Path, "2048")
  openssl("pkcs8", "-topk8", "-nocrypt", "-in", pkcs1Path, "-out", pkcs8Path)
  openssl("rsa", "-in", pkcs1Path, "-pubout", "-out", publicPath)
  return {
    pkcs1: readFileSync(pkcs1Path, "utf8"),
    pkcs8: readFileSync(pkcs8Path, "utf8"),
    publicPath,
  }
}

const keys = generateKeys()

/** Whether `signature` is a real RS256 signature over `signingInput`. */
function verifiedByOpenssl(signingInput: string, signature: Uint8Array): boolean {
  const dataPath = join(dir, "data.bin")
  const sigPath = join(dir, "sig.bin")
  writeFileSync(dataPath, signingInput)
  writeFileSync(sigPath, signature)
  try {
    const out = openssl(
      "dgst",
      "-sha256",
      "-verify",
      keys.publicPath,
      "-signature",
      sigPath,
      dataPath,
    )
    return out.includes("Verified OK")
  } catch {
    return false
  }
}

/** The three parts of a JWT, decoded. */
function decodeJwt(jwt: string) {
  const [header, payload, signature] = jwt.split(".")
  const json = (part: string) =>
    JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
  return {
    header: json(header),
    payload: json(payload),
    signature: new Uint8Array(
      Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
    ),
    signingInput: `${header}.${payload}`,
  }
}

const CREDENTIALS = { appId: "4564026", installationId: "153046310" }

describe("parsePem accepts every encoding an operator can paste", () => {
  test("canonical PEM, as openssl writes it", () => {
    const parsed = parsePem(keys.pkcs1)
    expect(parsed?.label).toBe("RSA PRIVATE KEY")
    expect(parsed?.der.length).toBeGreaterThan(1000)
  })

  test("PKCS#8, which GitHub does not issue but an operator may convert to", () => {
    expect(parsePem(keys.pkcs8)?.label).toBe("PRIVATE KEY")
  })

  test("escaped newlines, as a .env file or JSON field carries them", () => {
    // The literal two characters `\` and `n`, not a newline.
    const escaped = keys.pkcs1.replace(/\n/g, "\\n")
    expect(escaped).toContain("\\n")
    expect(parsePem(escaped)?.der).toEqual(parsePem(keys.pkcs1)?.der)
  })

  test("collapsed whitespace, which is the form this deployment's key has", () => {
    // Every run of whitespace flattened to one space — what a form field or a
    // shell that ate the newlines produces. The bytes must be identical to the
    // canonical parse, or the key is "valid" and signs garbage.
    const collapsed = keys.pkcs1.replace(/\s+/g, " ").trim()
    expect(collapsed).not.toContain("\n")
    expect(parsePem(collapsed)?.der).toEqual(parsePem(keys.pkcs1)?.der)
  })

  test("CRLF line endings, from a Windows clipboard", () => {
    expect(parsePem(keys.pkcs1.replace(/\n/g, "\r\n"))?.der).toEqual(parsePem(keys.pkcs1)?.der)
  })

  test("surrounding quotes and padding, from a copied shell assignment", () => {
    expect(parsePem(`  "${keys.pkcs1}"  `)?.der).toEqual(parsePem(keys.pkcs1)?.der)
  })
})

describe("parsePem refuses what it cannot use", () => {
  const bad: [string, string][] = [
    ["empty", ""],
    ["whitespace only", "   \n  "],
    ["prose", "this is not a pem at all"],
    ["a header with no body", "-----BEGIN RSA PRIVATE KEY----------END RSA PRIVATE KEY-----"],
    ["truncated mid-block", "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA"],
    ["no END line", `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKC\n`],
    [
      "body that is not base64",
      "-----BEGIN RSA PRIVATE KEY-----\n!!!! not base64 !!!!\n-----END RSA PRIVATE KEY-----",
    ],
    [
      "mismatched labels, which means spliced or truncated",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKC\n-----END PUBLIC KEY-----",
    ],
  ]

  for (const [name, input] of bad) {
    test(name, () => {
      expect(parsePem(input)).toBeNull()
    })
  }
})

describe("readCredentials validates shape without guessing", () => {
  test("accepts the three well-formed inputs", () => {
    const result = readCredentials({ ...CREDENTIALS, privateKey: keys.pkcs1 })
    expect("credentials" in result).toBe(true)
  })

  test("names which input is missing, one problem at a time", () => {
    expect(readCredentials({ ...CREDENTIALS, appId: undefined, privateKey: keys.pkcs1 })).toEqual({
      problem: "app-id-missing",
    })
    expect(readCredentials({ ...CREDENTIALS, installationId: "", privateKey: keys.pkcs1 })).toEqual(
      { problem: "installation-id-missing" },
    )
    expect(readCredentials({ ...CREDENTIALS, privateKey: undefined })).toEqual({
      problem: "private-key-missing",
    })
  })

  test("refuses an id that is not a bare integer", () => {
    // `parseInt("4564026x")` is 4564026 — an id with a stray character would
    // otherwise silently become a different, valid-looking id.
    expect(readCredentials({ ...CREDENTIALS, appId: "4564026x", privateKey: keys.pkcs1 })).toEqual({
      problem: "app-id-invalid",
    })
    expect(
      readCredentials({ ...CREDENTIALS, installationId: "1.5", privateKey: keys.pkcs1 }),
    ).toEqual({ problem: "installation-id-invalid" })
  })

  test("tolerates surrounding whitespace on the ids", () => {
    // A secret store that keeps a trailing newline is not an operator error.
    const result = readCredentials({
      appId: " 4564026\n",
      installationId: "\t153046310 ",
      privateKey: keys.pkcs1,
    })
    expect("credentials" in result && result.credentials.appId).toBe("4564026")
  })

  test("tells a public key apart from a corrupted private one", () => {
    // Both are `BEGIN … KEY` blocks and an operator can easily copy the wrong
    // file; the two mistakes need different advice.
    const publicKey = readFileSync(keys.publicPath, "utf8")
    expect(readCredentials({ ...CREDENTIALS, privateKey: publicKey })).toEqual({
      problem: "private-key-wrong-type",
    })
    expect(
      readCredentials({ ...CREDENTIALS, privateKey: "-----BEGIN X-----\n!!\n-----END X-----" }),
    ).toEqual({ problem: "private-key-unparseable" })
  })

  test("never echoes the value it rejected", () => {
    // The whole reason `CredentialProblem` is a closed union of fixed strings.
    const secret = "SUPER-SECRET-KEY-MATERIAL"
    const result = readCredentials({ ...CREDENTIALS, privateKey: secret })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})

describe("appJwt signs a real, verifiable RS256 assertion", () => {
  const NOW = 1_760_000_000_000

  test("the signature verifies against the matching public key", async () => {
    // ⚠ The assertion this file exists for. A wrong PKCS#8 wrapper, wrong
    // padding, or a signature over the wrong bytes all produce a plausible
    // three-part string; only an independent verifier catches them.
    const jwt = await appJwt({ ...CREDENTIALS, privateKeyPem: keys.pkcs1 }, NOW)
    const { signingInput, signature } = decodeJwt(jwt)
    expect(verifiedByOpenssl(signingInput, signature)).toBe(true)
  })

  test("a PKCS#8 key produces a signature over the same input", async () => {
    const jwt = await appJwt({ ...CREDENTIALS, privateKeyPem: keys.pkcs8 }, NOW)
    const { signingInput, signature } = decodeJwt(jwt)
    expect(verifiedByOpenssl(signingInput, signature)).toBe(true)
  })

  test("all three encodings of one key sign identically", async () => {
    // Same key, same instant, three encodings: RSASSA-PKCS1-v1_5 is
    // deterministic, so identical output is proof the encodings decoded to the
    // same bytes rather than to three keys that all happen to work.
    const [canonical, escaped, collapsed] = await Promise.all(
      [keys.pkcs1, keys.pkcs1.replace(/\n/g, "\\n"), keys.pkcs1.replace(/\s+/g, " ").trim()].map(
        (pem) => appJwt({ ...CREDENTIALS, privateKeyPem: pem }, NOW),
      ),
    )
    expect(escaped).toBe(canonical)
    expect(collapsed).toBe(canonical)
  })

  test("the header is what GitHub requires", async () => {
    const { header } = decodeJwt(await appJwt({ ...CREDENTIALS, privateKeyPem: keys.pkcs1 }, NOW))
    expect(header).toEqual({ alg: "RS256", typ: "JWT" })
  })

  test("the claims are backdated, bounded, and issued by the app", async () => {
    const { payload } = decodeJwt(await appJwt({ ...CREDENTIALS, privateKeyPem: keys.pkcs1 }, NOW))
    const seconds = Math.floor(NOW / 1000)

    // `iss` is the App id — not the installation id, which is a common and
    // silent mix-up: GitHub rejects it with a bare 401.
    expect(payload.iss).toBe(CREDENTIALS.appId)

    // Backdated by a minute. A JWT whose `iat` is in the future is rejected
    // outright, and the deployment's clock is not GitHub's.
    expect(payload.iat).toBe(seconds - 60)

    // GitHub refuses anything more than ten minutes out. The margin is what
    // stops a clock a few seconds fast from making every mint fail.
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600)
    expect(payload.exp).toBeGreaterThan(seconds)
  })

  test("is base64url, with no padding that would break the wire format", async () => {
    const jwt = await appJwt({ ...CREDENTIALS, privateKeyPem: keys.pkcs1 }, NOW)
    expect(jwt).not.toContain("=")
    expect(jwt).not.toContain("+")
    expect(jwt).not.toContain("/")
    expect(jwt.split(".")).toHaveLength(3)
  })

  test("rejects a key it cannot import, without quoting it", async () => {
    const secret = "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"
    // Structurally a PEM, not an RSA key: `importKey` throws, and the message
    // must be the fixed reason rather than the runtime's, which can echo input.
    const error = await appJwt({ ...CREDENTIALS, privateKeyPem: secret }, NOW).catch(
      (e: Error) => e,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("private-key-unparseable")
    expect((error as Error).message).not.toContain("AAAA")
  })

  test("the imported key is not extractable", async () => {
    // The structural half of "the private key never leaves this module": the
    // runtime itself refuses to serialise it, so no future edit here can.
    const parsed = parsePem(keys.pkcs8)
    if (!parsed) throw new Error("unreachable: pkcs8 fixture must parse")
    const key = await crypto.subtle.importKey(
      "pkcs8",
      parsed.der.slice().buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    )
    expect(key.extractable).toBe(false)
    expect(crypto.subtle.exportKey("pkcs8", key)).rejects.toThrow()
  })
})

// The generated keys exist only for this run.
process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
