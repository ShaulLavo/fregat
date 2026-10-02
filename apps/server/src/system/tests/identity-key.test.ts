import { mkdtemp, rm, stat, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureIdentityKey, identityProof, readIdentityKey } from '../identity-key'

const homes: string[] = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

async function stateHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'platform-key-'))
  homes.push(home)
  return home
}

describe('identity key', () => {
  it('creates one owner-only key and keeps it', async () => {
    const home = await stateHome()
    const first = ensureIdentityKey(home)
    expect(first.length).toBe(32)
    expect(ensureIdentityKey(home)).toEqual(first)
    expect((await stat(path.join(home, 'identity.key'))).mode & 0o077).toBe(0)
  })

  it('refuses a key other users can read', async () => {
    const home = await stateHome()
    await writeFile(path.join(home, 'identity.key'), Buffer.alloc(32, 1))
    await chmod(path.join(home, 'identity.key'), 0o644)
    expect(readIdentityKey(home)).toBeNull()
  })

  it('proves the nonce only with the same key', async () => {
    const key = ensureIdentityKey(await stateHome())
    const other = ensureIdentityKey(await stateHome())
    expect(identityProof(key, 'nonce')).toBe(identityProof(key, 'nonce'))
    expect(identityProof(key, 'nonce')).not.toBe(identityProof(other, 'nonce'))
    expect(identityProof(key, 'nonce')).not.toBe(identityProof(key, 'other'))
  })
})
