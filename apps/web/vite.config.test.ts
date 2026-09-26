import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import configFn, { bunInstallCacheRoot } from './vite.config'

test('bunInstallCacheRoot reads BUN_INSTALL_CACHE_DIR when set', () => {
  expect(bunInstallCacheRoot({ BUN_INSTALL_CACHE_DIR: '/work/cache/bun/cache' })).toBe(
    '/work/cache/bun/cache',
  )
})

test('bunInstallCacheRoot falls back to the default Bun cache location', () => {
  expect(bunInstallCacheRoot({})).toBe(path.join(os.homedir(), '.bun', 'install', 'cache'))
})

test('dev server fs.allow includes the bun install cache root', () => {
  // Bun's isolated linker can symlink a dependency straight into this cache
  // instead of the workspace; Vite denies serving a real path outside `fs.allow`.
  const previous = process.env.BUN_INSTALL_CACHE_DIR
  process.env.BUN_INSTALL_CACHE_DIR = '/work/cache/bun/cache'
  try {
    // A build never reads dev-linked packages (that needs editor deps in package.json).
    const resolved = configFn({ command: 'build', mode: 'production' })
    expect(resolved.server?.fs?.allow).toContain('/work/cache/bun/cache')
  } finally {
    if (previous === undefined) delete process.env.BUN_INSTALL_CACHE_DIR
    else process.env.BUN_INSTALL_CACHE_DIR = previous
  }
})
