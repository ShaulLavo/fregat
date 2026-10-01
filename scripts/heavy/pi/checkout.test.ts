import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { fregatCheckout } from './checkout'

const checkout = path.resolve(import.meta.dirname, '../../..')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

test('accepts this checkout from a subdirectory', () => {
  expect(fregatCheckout(import.meta.dirname)).toBe(checkout)
})

test('refuses another repository shaped like Fregat', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'not-fregat-'))
  roots.push(root)
  mkdirSync(path.join(root, 'editor/packages/editor/dist'), { recursive: true })
  writeFileSync(path.join(root, 'editor/packages/editor/dist/index.js'), '')
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'other')
  expect(() => fregatCheckout(path.join(root, 'editor'))).toThrow(/not a Fregat checkout/)
})

test('refuses a directory outside git', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'no-git-'))
  roots.push(root)
  expect(() => fregatCheckout(root)).toThrow(/not inside a git checkout/)
})
