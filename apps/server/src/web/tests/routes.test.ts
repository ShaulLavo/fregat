import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'

const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('web routes', () => {
  it('serves the page for document navigations without an origin', async () => {
    const app = await webApp()
    for (const pathname of ['/', '/~platform.abc/workbench', '/@remote/~repo/chat/t/1']) {
      const response = await app.handle(navigation(pathname))
      expect(response.status, pathname).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(response.headers.get('cache-control')).toBe('no-cache')
      expect(await response.text()).toContain('<div id="root">')
    }
  })

  it('serves the dev gallery under /dev only when the release carries it', async () => {
    const app = await webApp()
    for (const pathname of ['/dev', '/dev/loaders']) {
      const response = await app.handle(navigation(pathname))
      expect(response.status, pathname).toBe(200)
      expect(await response.text()).toContain('<div id="dev">')
    }
    expect((await app.handle(navigation('/devtools'))).status).toBe(404)

    const bare = await webApp({ devPage: false })
    expect((await bare.handle(navigation('/dev/loaders'))).status).toBe(404)
  })

  it('serves release files with content types and caching by location', async () => {
    const app = await webApp()
    const script = await app.handle(new Request('http://local/assets/index-abc.js'))
    expect(script.status).toBe(200)
    expect(script.headers.get('cache-control')).toContain('immutable')
    expect(script.headers.get('content-type')).toContain('javascript')

    const wasm = await app.handle(new Request('http://local/assets/ghostty-vt.wasm'))
    expect(wasm.status).toBe(200)
    expect(wasm.headers.get('content-type')).toBe('application/wasm')

    const icon = await app.handle(new Request('http://local/vscode-icons/code.svg'))
    expect(icon.status).toBe(200)
    expect(icon.headers.get('cache-control')).toBe('no-cache')
  })

  it('returns 404 for missing files and unknown routes, never index.html', async () => {
    const app = await webApp()
    for (const pathname of ['/assets/missing.js', '/worker.js', '/fs/nope', '/~x/app.js']) {
      const response = await app.handle(new Request(`http://local${pathname}`))
      expect(response.status, pathname).toBe(404)
      expect((await response.json()).error.code).toBe('ROUTE_NOT_FOUND')
    }
    const documentMiss = await app.handle(navigation('/nowhere'))
    expect(documentMiss.status).toBe(404)
  })

  it('never leaves the release directory', async () => {
    const app = await webApp()
    for (const pathname of [
      '/../build-config.json',
      '/%2e%2e/build-config.json',
      '/assets/..%2f..%2fbuild-config.json',
    ]) {
      const response = await app.handle(new Request(`http://local${pathname}`))
      expect(response.status, pathname).not.toBe(200)
    }
    const directory = await app.handle(new Request('http://local/assets'))
    expect(directory.status).toBe(404)
  })

  it('keeps the API behind the origin guard and reports the release openly', async () => {
    const app = await webApp()
    const health = await app.handle(new Request('http://local/health'))
    expect(health.status).toBe(401)

    const release = await app.handle(new Request('http://local/release'))
    expect(release.status).toBe(200)
    expect(await release.json()).toEqual({
      release: 'stamp-abc-slug',
      commit: 'abc',
      dirtyFiles: 1,
      server: { release: null, commit: null, dirtyFiles: null },
      terminalHost: null,
      phase: 'serving',
      pending: null,
      liveCheck: null,
    })
  })

  it('reports the staged release and a failed live check, re-read on every call', async () => {
    const root = await fixtureRoot()
    const production = path.join(root, 'production')
    const current = await release(production, 'current-release', {
      source: '/work/projects/platform',
      previousRelease: path.join(production, 'releases', 'older-release'),
    })
    await symlink(current, path.join(production, 'current'))
    await writeFile(
      path.join(current, 'live-check.json'),
      JSON.stringify({
        release: 'current-release',
        status: 'failed',
        checkedAt: '2026-09-25T10:00:00.000Z',
        fresh: ['no websocket received a frame'],
      }),
    )
    const app = createTestApp({
      settings: testSettingsOptions(root),
      update: { root: production, restart: () => {} },
      workspaceRoot: root,
    })
    const read = async () => (await app.handle(new Request('http://local/release'))).json()

    expect(await read()).toMatchObject({ phase: 'serving', pending: null })
    await symlink(await release(production, 'staged-release'), path.join(production, 'pending'))

    expect(await read()).toMatchObject({
      phase: 'serving',
      pending: { release: 'staged-release', stagedAt: expect.any(String) },
      liveCheck: {
        release: 'current-release',
        status: 'failed',
        at: '2026-09-25T10:00:00.000Z',
        error: {
          code: 'update.LIVE_CHECK_FAILED',
          message: 'current-release failed its live check',
          why: 'no websocket received a frame',
          fix: 'Run bun run deploy --rollback in /work/projects/platform to return to older-release.',
        },
      },
    })
  })

  it('does not shadow the machine proxy with the static catch-all', async () => {
    const app = await webApp()
    // The proxy's own guard answers 401; the web handler would have answered 404.
    const http = await app.handle(new Request('http://local/machines/mac/proxy/orchestration/rpc'))
    expect(http.status).toBe(401)

    const upgrade = await app.handle(
      new Request('http://local/machines/mac/proxy/orchestration/rpc', {
        headers: { connection: 'Upgrade', upgrade: 'websocket' },
      }),
    )
    expect(upgrade.status).toBe(401)
  })

  it('refuses a web root that does not exist', async () => {
    const root = await fixtureRoot()
    expect(() =>
      createTestApp({
        settings: testSettingsOptions(root),
        web: { root: path.join(root, 'missing') },
        workspaceRoot: root,
      }),
    ).toThrow(/Web root is not a directory/)
  })
})

async function webApp({ devPage = true } = {}) {
  const root = await fixtureRoot()
  const release = path.join(root, 'stamp-abc-slug')
  const web = path.join(release, 'web')
  await mkdir(path.join(web, 'assets'), { recursive: true })
  await mkdir(path.join(web, 'vscode-icons'), { recursive: true })
  await writeFile(path.join(web, 'index.html'), '<html><body><div id="root"></div></body></html>')
  if (devPage)
    await writeFile(path.join(web, 'dev.html'), '<html><body><div id="dev"></div></body></html>')
  await writeFile(path.join(web, 'assets', 'index-abc.js'), 'console.log(1)')
  await writeFile(path.join(web, 'assets', 'ghostty-vt.wasm'), new Uint8Array([0, 97, 115, 109]))
  await writeFile(path.join(web, 'vscode-icons', 'code.svg'), '<svg/>')
  await writeFile(
    path.join(release, 'build-config.json'),
    JSON.stringify({ release, commit: 'abc', dirtyFiles: ['x.ts'] }),
  )
  return createTestApp({
    settings: testSettingsOptions(root),
    web: { root: web },
    workspaceRoot: root,
  })
}

function navigation(pathname: string) {
  return new Request(`http://local${pathname}`, {
    headers: { accept: 'text/html,*/*', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' },
  })
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-web-routes-'))
  roots.push(root)
  return root
}

async function release(production: string, name: string, config: Record<string, unknown> = {}) {
  const directory = path.join(production, 'releases', name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'build-config.json'),
    JSON.stringify({ release: directory, ...config }),
  )
  return directory
}
