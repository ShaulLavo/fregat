import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { readNativeUsageMetadata } from '../usage-native-metadata'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function codexMetadata(email: unknown) {
  return {
    tokens: {
      id_token: `e30.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.fixture`,
      access_token: 'synthetic-access-token',
      account_id: 'synthetic-private-account',
    },
  }
}

test.each([
  { email: 'fixture.person@example.test', label: 'fixture.person' },
  { email: '  fixture.work+cli@example.test  ', label: 'fixture.work+cli' },
  { email: 'full@address@example.test', label: undefined },
  { email: 'unsafe name@example.test', label: undefined },
  { email: 'unsafe‮@example.test', label: undefined },
  { email: 'x'.repeat(65) + '@example.test', label: undefined },
  { email: null, label: undefined },
  { email: 42, label: undefined },
])('native metadata sanitizes $email', async ({ email, label }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-label-'))
  roots.push(root)
  const file = path.join(root, 'metadata.json')
  await writeFile(file, JSON.stringify(codexMetadata(email)))
  expect((await readNativeUsageMetadata(file, 'codex')).label).toBe(label)
  await writeFile(file, JSON.stringify({ oauthAccount: { emailAddress: email } }))
  expect((await readNativeUsageMetadata(file, 'claude')).label).toBe(label)
})

test('missing, malformed and oversized metadata falls back without exporting contents', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-label-'))
  roots.push(root)
  const file = path.join(root, 'metadata.json')
  expect((await readNativeUsageMetadata(file, 'codex')).label).toBeUndefined()
  for (const value of [
    '{',
    'null',
    '{"tokens":{"id_token":"bad.token"}}',
    'x'.repeat(2 * 1024 * 1024 + 1),
  ]) {
    await writeFile(file, value)
    expect((await readNativeUsageMetadata(file, 'codex')).label).toBeUndefined()
    expect((await readNativeUsageMetadata(file, 'claude')).label).toBeUndefined()
  }
})

test('a malformed optional label token preserves a valid native identity proof', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-identity-'))
  roots.push(root)
  const file = path.join(root, 'metadata.json')
  await writeFile(
    file,
    JSON.stringify({ tokens: { account_id: 'fixture-account-id', id_token: 'bad.token' } }),
  )
  const metadata = await readNativeUsageMetadata(file, 'codex', 'a'.repeat(64))
  expect(metadata.label).toBeUndefined()
  expect(metadata.identityProof).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(metadata)).not.toContain('fixture-account-id')
  expect((await readNativeUsageMetadata(file, 'codex', 'b'.repeat(64))).identityProof).not.toBe(
    metadata.identityProof,
  )
})
