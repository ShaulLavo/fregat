import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { shipPlan } from './transfer'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'lane-transfer-'))
  roots.push(root)
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root].concat(args), { stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'lane@example.test')
  git('config', 'user.name', 'lane')
  writeFileSync(path.join(root, '.gitignore'), 'scratch/\n')
  writeFileSync(path.join(root, 'tracked.ts'), 'export const a = 1\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  writeFileSync(path.join(root, 'tracked.ts'), 'export const a = 2\n')
  writeFileSync(path.join(root, 'new.ts'), 'export const b = 1\n')
  writeFileSync(path.join(root, 'notes.md'), 'unnamed\n')
  mkdirSync(path.join(root, 'scratch'))
  writeFileSync(path.join(root, 'scratch/big.bin'), 'x')
  return root
}

test('ships tracked changes and keeps unnamed untracked files here', () => {
  const root = repository()
  const plan = shipPlan(root, [], 2 ** 20, root)
  expect(Buffer.from(plan.diff).toString()).toContain('+export const a = 2')
  expect(plan.includes).toEqual([])
  expect(plan.omitted.toSorted()).toEqual(['new.ts', 'notes.md'])
})

test('ships a named untracked file', () => {
  const root = repository()
  const plan = shipPlan(root, ['new.ts'], 2 ** 20, root)
  expect(plan.includes).toEqual(['new.ts'])
  expect(plan.omitted).toEqual(['notes.md'])
})

test.each([
  '.env.production',
  '.env',
  'id_ed25519.pem',
  'apikey.txt',
  'credentials.json',
  'config/Credentials.yml',
])('refuses the secret-like include %s', (name) => {
  const root = repository()
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
  writeFileSync(path.join(root, name), 'secret')
  expect(() => shipPlan(root, [name], 2 ** 20, root)).toThrow(/looks like a secret/)
})

test('refuses gitignored, tracked, missing and outside includes', () => {
  const root = repository()
  expect(() => shipPlan(root, ['scratch/big.bin'], 2 ** 20, root)).toThrow(/gitignored/)
  expect(() => shipPlan(root, ['tracked.ts'], 2 ** 20, root)).toThrow(/tracked/)
  expect(() => shipPlan(root, ['missing.ts'], 2 ** 20, root)).toThrow(/not a file/)
  expect(() => shipPlan(root, ['../outside.ts'], 2 ** 20, root)).toThrow(/outside/)
})

test('refuses a transfer over the cap, counting the diff', () => {
  const root = repository()
  writeFileSync(path.join(root, 'tracked.ts'), 'x'.repeat(4096))
  expect(() => shipPlan(root, [], 1024, root)).toThrow(/over the 1024-byte cap/)
})
