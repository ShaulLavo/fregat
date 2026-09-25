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

test('carries the served build’s hashed assets the new build lacks, and nothing older than a week', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'carry-assets-'))
  roots.push(root)
  const previous = webDir(root, 'previous', {
    'panel-old.js': 'old panel',
    'shared-same.js': 'previous copy',
    'grammar-stale.js': 'stale',
  })
  const next = webDir(root, 'next', { 'shared-same.js': 'new copy', 'panel-new.js': 'new panel' })
  const now = Date.now()
  const stale = new Date(now - CARRIED_ASSET_MAX_AGE_MS - 60_000)
  utimesSync(path.join(previous, 'assets', 'grammar-stale.js'), stale, stale)

  expect(carryAssets(previous, next, now)).toBe(1)

  const carried = path.join(next, 'assets', 'panel-old.js')
  expect(readFileSync(carried, 'utf8')).toBe('old panel')
  expect(statSync(carried).ino).toBe(statSync(path.join(previous, 'assets', 'panel-old.js')).ino)
  expect(readFileSync(path.join(next, 'assets', 'shared-same.js'), 'utf8')).toBe('new copy')
  expect(() => statSync(path.join(next, 'assets', 'grammar-stale.js'))).toThrow()
})
