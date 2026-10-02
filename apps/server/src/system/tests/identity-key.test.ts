import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureIdentityKey, identityProof, proofMatches, readIdentityKey } from '../identity-key'

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
  it('replaces a key other users can read with a fresh owner-only one', async () => {
    const home = await stateHome()
    const file = path.join(home, 'identity.key')
    await writeFile(file, Buffer.alloc(32, 1))
    await chmod(file, 0o644)
    const key = ensureIdentityKey(home)
    expect(key).not.toEqual(Buffer.alloc(32, 1))
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(readIdentityKey(home)).toEqual(key)
  })

  it('replaces a linked key without writing through the link', async () => {
    const home = await stateHome()
    const target = path.join(await stateHome(), 'elsewhere')
    await writeFile(target, 'untouched')
    await symlink(target, path.join(home, 'identity.key'))
    expect(readIdentityKey(home)).toBeNull()
    const key = ensureIdentityKey(home)
    expect((await lstat(path.join(home, 'identity.key'))).isFile()).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('untouched')
    expect(readIdentityKey(home)).toEqual(key)
  })

  it('compares proofs in constant time and refuses malformed ones', async () => {
    const key = ensureIdentityKey(await stateHome())
    const proof = identityProof(key, 'nonce')
    expect(proofMatches(key, 'nonce', proof)).toBe(true)
    expect(proofMatches(key, 'nonce', proof.slice(1))).toBe(false)
    expect(proofMatches(key, 'nonce', null)).toBe(false)
    expect(proofMatches(key, 'other', proof)).toBe(false)
  })
})
