import { createDecipheriv, createECDH, createHmac, randomBytes, webcrypto } from 'node:crypto'

/**
 * The browser end of Web Push: a P-256 key pair and auth secret, and the RFC 8291
 * decryption a push service's client runs. Written from the RFCs, so it checks the
 * server's library and never reuses it.
 */
export type PushSubscriber = {
  readonly subscription: {
    readonly endpoint: string
    readonly keys: { readonly p256dh: string; readonly auth: string }
  }
  /** Decrypts an `aes128gcm` body (RFC 8188 framing, RFC 8291 keys) to its text. */
  readonly decrypt: (body: Uint8Array) => string
}

export type VapidClaims = { readonly aud: string; readonly exp: number; readonly sub: string }

export function createPushSubscriber(endpoint: string): PushSubscriber {
  const curve = createECDH('prime256v1')
  curve.generateKeys()
  const publicKey = curve.getPublicKey()
  const auth = randomBytes(16)

  return {
    subscription: {
      endpoint,
      keys: { p256dh: publicKey.toString('base64url'), auth: auth.toString('base64url') },
    },
    decrypt: (body) => decryptAes128gcm(Buffer.from(body), curve, publicKey, auth),
  }
}

function decryptAes128gcm(
  body: Buffer,
  curve: ReturnType<typeof createECDH>,
  receiverKey: Buffer,
  auth: Buffer,
) {
  const salt = body.subarray(0, 16)
  const keyIdLength = body[20] ?? 0
  const senderKey = body.subarray(21, 21 + keyIdLength)
  const record = body.subarray(21 + keyIdLength)
  const secret = curve.computeSecret(senderKey)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverKey, senderKey])
  const ikm = hkdf(auth, secret, keyInfo, 32)
  const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const decipher = createDecipheriv('aes-128-gcm', key, nonce)
  decipher.setAuthTag(record.subarray(record.length - 16))
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ])

  // The last record ends with a 0x02 delimiter, then zero padding.
  return padded.subarray(0, padded.lastIndexOf(2)).toString('utf8')
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number) {
  const prk = createHmac('sha256', salt).update(ikm).digest()

  return createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length)
}

/** Verifies `vapid t=<jwt>, k=<key>` (RFC 8292) against `publicKey`; null when it does not verify. */
export async function verifyVapidAuthorization(
  header: string | null,
  publicKey: string,
): Promise<VapidClaims | null> {
  const match = /^vapid t=([^,\s]+), k=([A-Za-z0-9_-]+)$/.exec(header ?? '')
  if (!match || match[2] !== publicKey) return null

  const [head = '', claims = '', signature = ''] = (match[1] ?? '').split('.')
  if (JSON.parse(Buffer.from(head, 'base64url').toString('utf8')).alg !== 'ES256') return null
  const key = await webcrypto.subtle.importKey(
    'raw',
    Buffer.from(publicKey, 'base64url'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const verified = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(signature, 'base64url'),
    Buffer.from(`${head}.${claims}`),
  )
  if (!verified) return null

  return JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as VapidClaims
}
