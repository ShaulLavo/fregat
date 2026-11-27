import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { renameExclusive } from '../../git/utils/rename-exclusive'
import { NativeWatchHost, WATCH_WORKER_FAILED } from '../../fs/native-watch-host'
import { FontCatalogService } from '../../fonts/catalog'
import { InstalledFontProvider } from '../../fonts/installed'
import { hasDesktopSession } from '../../system/native-helper'
import { readHostResources } from '../../machines/resources'

const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function scratch() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-wasi-ready-'))
  roots.push(root)
  return root
}

describe('WASI and host-independent server degradations', () => {
  it('renameExclusive fallback publishes to an unused path and refuses overwrite', async () => {
    const root = await scratch()
    const source = path.join(root, 'staging')
    const destination = path.join(root, 'published')
    await mkdir(source)
    await writeFile(path.join(source, 'marker.txt'), 'ok')

    expect(renameExclusive(source, destination, { useNativeFfi: false })).toBe(true)

    const second = path.join(root, 'staging-2')
    await mkdir(second)
    expect(renameExclusive(second, destination, { useNativeFfi: false })).toBe(false)
  })

  it('InstalledFontProvider degrades to empty list when fontconfig is unavailable', async () => {
    const provider = new InstalledFontProvider({
      list: () => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      subsetter: async (buffer) => buffer,
    })
    expect(await provider.fonts()).toEqual([])
  })

  it('hasDesktopSession returns false in headless environments on Linux', () => {
    if (process.platform !== 'linux') return
    expect(hasDesktopSession({})).toBe(false)
  })

  it('NativeWatchHost resolves failed instead of throwing when worker cannot start', async () => {
    const host = new NativeWatchHost('/nonexistent/watch-worker.ts')
    try {
      const result = await host.watch('/tmp', false, { event: () => {}, error: () => {} })
      expect(result.status).toBe('failed')
      if (result.status === 'failed') expect(result.error.code).toBe(WATCH_WORKER_FAILED)
    } finally {
      host.close()
    }
  })

  it('readHostResources returns valid memory and CPU bounds', async () => {
    const resources = await readHostResources()
    expect(resources.totalMemoryBytes).toBeGreaterThan(0)
    expect(resources.availableMemoryBytes).toBeGreaterThanOrEqual(0)
    expect(resources.availableMemoryBytes).toBeLessThanOrEqual(resources.totalMemoryBytes)
  })

  it('boots cleanly with zero native agent CLIs and no desktop picker', async () => {
    const root = await scratch()
    const savedPath = process.env.PATH
    process.env.PATH = ''
    try {
      const app = createTestApp({
        workspaceRoot: root,
        orchestration: { providerRuntime: true },
        settings: testSettingsOptions(root),
        system: {
          nativePickerHelper: null,
          desktop: () => false,
          machineId: () => '0123456789abcdef0123456789abcdef' as never,
        },
        fonts: new FontCatalogService({
          listInstalled: () => Promise.resolve(''),
        }),
      })

      const headers = { origin: 'http://localhost:5173' }
      const health = await app.handle(new Request('http://localhost/health', { headers }))
      expect(health.status).toBe(200)
      expect((await health.json()) as { ok: boolean }).toMatchObject({ ok: true })

      const capabilities = await app.handle(
        new Request('http://localhost/system/capabilities', { headers }),
      )
      expect(capabilities.status).toBe(200)
      expect((await capabilities.json()) as { nativePicker: boolean }).toMatchObject({
        nativePicker: false,
      })

      const providers = await app.handle(new Request('http://localhost/providers', { headers }))
      expect(providers.status).toBe(200)
      const body = (await providers.json()) as {
        providers: Array<{ driverKind: string; installed: boolean; status: string }>
      }
      expect(body.providers.length).toBeGreaterThan(0)
      const codex = body.providers.find((entry) => entry.driverKind === 'codex')
      expect(codex).toMatchObject({ installed: false })
      const cursor = body.providers.find((entry) => entry.driverKind === 'cursor')
      expect(cursor).toMatchObject({ installed: false })
      const opencode = body.providers.find((entry) => entry.driverKind === 'opencode')
      expect(opencode).toMatchObject({ installed: false, status: 'disabled' })
    } finally {
      process.env.PATH = savedPath
    }
  })
})
