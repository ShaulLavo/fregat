import { test, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packages } from '../scripts/packages'

const root = fileURLToPath(new URL('../../packages/', import.meta.url))

test('includes normalized nested core declaration exports', () => {
  const core = packages.find((entry) => entry.name === '@singapore-editor/core')
  expect(core?.entryPoints).toContain(resolve(root, 'editor/dist/public/document.d.ts'))
  expect(core?.entryPoints).toContain(resolve(root, 'editor/dist/public/extensions.d.ts'))
  expect(core?.entryPoints).toContain(resolve(root, 'editor/dist/editor.d.ts'))
})

test('published package groups have existing public declaration entry points', () => {
  expect(packages.length).toBeGreaterThan(0)
  for (const entry of packages) {
    expect(entry.name).toMatch(/^@singapore-editor\//)
    expect(entry.private).not.toBe(true)
    expect(entry.entryPoints.length, entry.name).toBeGreaterThan(0)
    for (const path of entry.entryPoints) {
      expect(isAbsolute(path), path).toBe(true)
      expect(path).toBe(normalize(path))
      expect(path).not.toContain('internal')
      expect(existsSync(path), path).toBe(true)
    }
  }
})
