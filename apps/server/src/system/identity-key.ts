import { createHmac, randomBytes } from 'node:crypto'
import { closeSync, openSync, readFileSync, statSync, writeSync } from 'node:fs'
import path from 'node:path'

const KEY_FILE = 'identity.key'

/** The response header carrying `identityProof` for the request's `challenge`. */
export const IDENTITY_PROOF_HEADER = 'x-fregat-identity-proof'
const KEY_BYTES = 32

/**
 * Proves a server holds this state home: setup reads the key from the state home it expects and
 * checks the proof a listener returns. Create it only while holding the state-home lock.
 */
export function ensureIdentityKey(stateHome: string): Buffer {
  const existing = readIdentityKey(stateHome)
  if (existing) return existing
  const key = randomBytes(KEY_BYTES)
  const fd = openSync(path.join(stateHome, KEY_FILE), 'w', 0o600)
  try {
    writeSync(fd, key)
  } finally {
    closeSync(fd)
  }
  return key
}

/** Null when absent, the wrong size, or readable by anyone but its owner. */
export function readIdentityKey(stateHome: string): Buffer | null {
  const file = path.join(stateHome, KEY_FILE)
  try {
    if ((statSync(file).mode & 0o077) !== 0) return null
    const key = readFileSync(file)
    return key.length === KEY_BYTES ? key : null
  } catch {
    return null
  }
}

export function identityProof(key: Buffer, nonce: string) {
  return createHmac('sha256', key).update(`fregat-identity:${nonce}`).digest('hex')
}
