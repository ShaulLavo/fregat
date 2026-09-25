import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { CARRIED_ASSET_MAX_AGE_MS, carryAssets } from './release'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function webDir(root: string, name: string, files: Record<string, string>) {
  const web = path.join(root, name, 'web')
  mkdirSync(path.join(web, 'assets'), { recursive: true })
  for (const [file, content] of Object.entries(files))
    writeFileSync(path.join(web, 'assets', file), content)
  return web
}

test('carries every asset the served build lacks, however long ago it was built', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'carry-assets-'))
  roots.push(root)
  const previous = webDir(root, 'previous', {
    'panel-old.js': 'old panel',
    'shared-same.js': 'previous copy',
  })
  const next = webDir(root, 'next', { 'shared-same.js': 'new copy', 'panel-new.js': 'new panel' })
  const now = Date.now()
  const built = new Date(now - CARRIED_ASSET_MAX_AGE_MS - 60_000)
  utimesSync(path.join(previous, 'assets', 'panel-old.js'), built, built)

  expect(carryAssets(previous, next, now)).toBe(1)

  const carried = path.join(next, 'assets', 'panel-old.js')
  expect(readFileSync(carried, 'utf8')).toBe('old panel')
  expect(statSync(carried).ino).toBe(statSync(path.join(previous, 'assets', 'panel-old.js')).ino)
  expect(readFileSync(path.join(next, 'assets', 'shared-same.js'), 'utf8')).toBe('new copy')
})

test('drops a carried asset a week after its build stopped being served', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'carry-assets-'))
  roots.push(root)
  const first = webDir(root, 'first', { 'grammar-old.js': 'grammar' })
  const second = webDir(root, 'second', { 'panel-second.js': 'second' })
  const third = webDir(root, 'third', { 'panel-third.js': 'third' })
  const fourth = webDir(root, 'fourth', {})
  const retiredAt = Date.now() - CARRIED_ASSET_MAX_AGE_MS
  expect(carryAssets(first, second, retiredAt)).toBe(1)

  expect(carryAssets(second, third, retiredAt + 1_000)).toBe(2)
  expect(carryAssets(third, fourth, retiredAt + CARRIED_ASSET_MAX_AGE_MS + 60_000)).toBe(1)
  expect(() => statSync(path.join(fourth, 'assets', 'grammar-old.js'))).toThrow()
  expect(readFileSync(path.join(fourth, 'assets', 'panel-third.js'), 'utf8')).toBe('third')
})
