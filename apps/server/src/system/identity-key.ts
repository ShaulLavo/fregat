import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'

const KEY_FILE = 'identity.key'
const KEY_BYTES = 32

/** The response header carrying `identityProof` for the request's `challenge`. */
export const IDENTITY_PROOF_HEADER = 'x-fregat-identity-proof'

/**
 * Proves a server holds this state home: setup reads the key from the state home it expects and
 * checks the proof a listener returns. Call only while holding the state-home lock. An unsafe
 * existing key (shared mode, another owner, a link) is replaced, never reused.
 */
export function ensureIdentityKey(stateHome: string): Buffer {
  const existing = readIdentityKey(stateHome)
  if (existing) return existing
  const key = randomBytes(KEY_BYTES)
  const file = path.join(stateHome, KEY_FILE)
  const staging = `${file}.next-${process.pid}`
  rmSync(staging, { force: true })
  // `wx` never follows or reuses an existing path; the rename replaces a link, not its target.
  const fd = openSync(staging, 'wx', 0o600)
  try {
    writeSync(fd, key)
  } finally {
    closeSync(fd)
  }
  renameSync(staging, file)
  return key
}

/** Null unless it is a regular file this user owns, readable by nobody else, of the right size. */
export function readIdentityKey(stateHome: string): Buffer | null {
  const file = path.join(stateHome, KEY_FILE)
  try {
    const info = lstatSync(file)
    if (!info.isFile() || (info.mode & 0o077) !== 0) return null
    if (process.getuid && info.uid !== process.getuid()) return null
    const key = readFileSync(file)
    return key.length === KEY_BYTES ? key : null
  } catch {
    return null
  }
}

export function identityProof(key: Buffer, nonce: string) {
  return createHmac('sha256', key).update(`fregat-identity:${nonce}`).digest('hex')
}

export function proofMatches(key: Buffer, nonce: string, proof: string | null) {
  if (proof === null || !/^[0-9a-f]{64}$/.test(proof)) return false
  return timingSafeEqual(Buffer.from(identityProof(key, nonce), 'hex'), Buffer.from(proof, 'hex'))
}
