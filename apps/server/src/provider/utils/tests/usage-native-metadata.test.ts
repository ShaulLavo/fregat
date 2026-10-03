import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { readNativeUsageLabel } from '../usage-native-metadata'

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
  expect(await readNativeUsageLabel(file, 'codex')).toBe(label)
  await writeFile(file, JSON.stringify({ oauthAccount: { emailAddress: email } }))
  expect(await readNativeUsageLabel(file, 'claude')).toBe(label)
})

test('missing, malformed and oversized metadata falls back without exporting contents', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'usage-label-'))
  roots.push(root)
  const file = path.join(root, 'metadata.json')
  expect(await readNativeUsageLabel(file, 'codex')).toBeUndefined()
  for (const value of [
    '{',
    'null',
    '{"tokens":{"id_token":"bad.token"}}',
    'x'.repeat(2 * 1024 * 1024 + 1),
  ]) {
    await writeFile(file, value)
    expect(await readNativeUsageLabel(file, 'codex')).toBeUndefined()
    expect(await readNativeUsageLabel(file, 'claude')).toBeUndefined()
  }
})
