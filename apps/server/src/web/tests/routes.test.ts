import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { DEFAULT_ALLOWED_ORIGINS } from '../../auth'
import {
  HTML_BOOTSTRAP_ID,
  HTML_BOOTSTRAP_PALETTE_ID,
  HTML_BOOTSTRAP_WALLPAPER_IDS,
  type HtmlBootstrap,
} from '@workspace/contracts'

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
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).toContain('<div id="root">')
    }
  })

  it('serves the page for a pairing link, whose code stays in the fragment', async () => {
    const app = await webApp()
    const response = await app.handle(navigation('/pair'))

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<div id="root">')
  })

  it('personalizes direct app filenames and navigation fallbacks through the same policy', async () => {
    const app = await webApp()
    for (const pathname of ['/index.html', '/dev.html', '/~repo/workbench']) {
      const response = await app.handle(navigation(pathname))
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(embedded(html)).toMatchObject({ version: 1, kind: 'app', apiBase: 'http://local/' })
    }
  })

  it('rejects a direct foreign document host before returning private bootstrap data', async () => {
    const app = await webApp()
    const response = await app.handle(
      new Request('http://foreign.test/index.html', {
        headers: { accept: 'text/html', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' },
      }),
    )
    expect(response.status).toBe(403)
    const body = await response.text()
    expect(body).toContain('web.BOOTSTRAP_DOCUMENT_ORIGIN_INVALID')
    expect(body).not.toContain(HTML_BOOTSTRAP_ID)
    expect(body).not.toContain('graphite')
    expect(body).not.toContain('/wallpaper/still')
  })

  it('uses a trusted forwarded HTTPS origin in the payload and preloads with the configured base', async () => {
    const app = await webApp({
      allowedOrigins: ['https://example.test'],
      webBase: '/prefix/',
      pairing: false,
    })
    const request = navigation('/~repo/workbench')
    request.headers.set('x-forwarded-proto', 'https')
    request.headers.set('x-forwarded-host', 'example.test')
    const response = await app.handle(request)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(embedded(html)).toMatchObject({ kind: 'app', apiBase: 'https://example.test/prefix/' })
    expect(html).toContain('href="https://example.test/prefix/wallpaper/still"')
    expect(html).not.toContain('http://local')
  })

  it('uses the same forwarded address for the development adapter default', async () => {
    const app = await webApp({
      development: true,
      pairing: false,
      allowedOrigins: ['https://example.test'],
      webBase: '/prefix/',
    })
    const response = await app.handle(
      new Request('http://local/web/bootstrap', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://example.test',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'example.test',
        },
        body: JSON.stringify({ html: appTemplate('root') }),
      }),
    )
    expect(response.status).toBe(200)
    expect(embedded(await response.text())).toMatchObject({
      kind: 'app',
      apiBase: 'https://example.test/prefix/',
    })
  })

  it('rejects malformed and untrusted forwarded addresses before private appearance is returned', async () => {
    const app = await webApp({ allowedOrigins: ['https://example.test'] })
    for (const headers of [
      { 'x-forwarded-proto': 'https' },
      { 'x-forwarded-host': 'example.test' },
      { 'x-forwarded-proto': 'https,http', 'x-forwarded-host': 'example.test' },
      { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'unknown.test' },
      { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'example.test/other' },
      { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'example.test:invalid' },
      { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'user@example.test' },
    ]) {
      const request = navigation('/index.html')
      for (const [name, value] of Object.entries(headers)) request.headers.set(name, value)
      const response = await app.handle(request)
      expect(response.status).toBe(400)
      const body = await response.text()
      expect(body).toContain('web.BOOTSTRAP_PROXY_INVALID')
      expect(body).not.toContain('graphite')
    }
  })

  it('keeps private appearance out of unadmitted documents, including direct filenames', async () => {
    const app = await webApp()
    for (const pathname of ['/', '/index.html', '/dev.html']) {
      const request = navigation(pathname)
      request.headers.set('x-forwarded-for', '203.0.113.92')
      const response = await app.handle(request)
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(embedded(html)).toEqual({ version: 1, kind: 'pairing' })
      expect(html).not.toContain('graphite')
      expect(html).not.toContain('/wallpaper/still')
      expect(html).not.toContain(HTML_BOOTSTRAP_PALETTE_ID)
    }
  })

  it('checks the development adapter origin before returning private data', async () => {
    const app = await webApp({ development: true })
    const response = await app.handle(
      new Request('http://local/web/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://unknown.test' },
        body: JSON.stringify({ html: appTemplate('root') }),
      }),
    )
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('graphite')
    const admitted = await app.handle(
      new Request('http://local/web/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({
          html: appTemplate('root'),
          apiBase: 'http://localhost:5173/prefix/',
        }),
      }),
    )
    expect(admitted.status).toBe(200)
    expect(embedded(await admitted.text())).toMatchObject({
      kind: 'app',
      apiBase: 'http://localhost:5173/prefix/',
    })
  })

  it('keeps development documents generic before admission and rejects a foreign API base', async () => {
    const app = await webApp({ development: true })
    const post = (apiBase: string, forwarded = false) =>
      app.handle(
        new Request('http://local/web/bootstrap', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:5173',
            ...(forwarded ? { 'x-forwarded-for': '203.0.113.92' } : {}),
          },
          body: JSON.stringify({ html: appTemplate('root'), apiBase }),
        }),
      )
    const foreign = await post('https://unknown.test/')
    expect(foreign.status).toBe(403)
    expect(await foreign.text()).not.toContain('graphite')
    const generic = await post('http://localhost:5173/', true)
    expect(generic.status).toBe(200)
    const html = await generic.text()
    expect(embedded(html)).toEqual({ version: 1, kind: 'pairing' })
    expect(html).not.toContain('/wallpaper/still')
  })

  it('accepts the development API own origin independently of the allowed frontend origin', async () => {
    const app = await webApp({ development: true, allowedOrigins: ['https://frontend.test'] })
    for (const apiBase of [undefined, 'http://localhost:42917/prefix/']) {
      const response = await app.handle(
        new Request('http://localhost:42917/web/bootstrap', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://frontend.test' },
          body: JSON.stringify({ html: appTemplate('root'), ...(apiBase ? { apiBase } : {}) }),
        }),
      )
      expect(response.status).toBe(200)
      expect(embedded(await response.text())).toMatchObject({
        kind: 'app',
        apiBase: apiBase ?? 'http://localhost:42917/',
      })
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

  it('serves the notices index and exact web and server texts', async () => {
    const app = await webApp()
    const redirect = await app.handle(navigation('/licenses'))
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('location')).toBe('licenses/')
    for (const location of ['/licenses/']) {
      const response = await app.handle(navigation(location))
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('Third-party notices')
    }
    for (const location of ['/licenses/THIRD_PARTY_NOTICES.txt', '/licenses/server.txt']) {
      const response = await app.handle(new Request(`http://local${location}`))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/plain')
      expect(response.headers.get('cache-control')).toBe('no-cache')
      expect(await response.text()).toContain('Copyright fixture')
    }
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
    expect(release.headers.get('cache-control')).toBe('no-store')
    expect(await release.json()).toEqual({
      release: 'stamp-abc-slug',
      commit: 'abc',
      dirtyFiles: 1,
      server: { release: null, commit: null, dirtyFiles: null },
      terminalHost: null,
      phase: 'serving',
      pending: null,
      liveCheck: null,
      liveCheckRequired: true,
      busy: [],
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
          message: 'Deployment check failed',
          why: 'no websocket received a frame',
          fix: 'Review the failed check in the deployment report and retry the check.',
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

const defaultOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS

async function webApp({
  devPage = true,
  development = false,
  allowedOrigins = defaultOrigins.concat(['http://local']),
  webBase = '/',
  pairing = true,
}: {
  devPage?: boolean
  development?: boolean
  allowedOrigins?: readonly string[]
  webBase?: string
  pairing?: boolean
} = {}) {
  const root = await fixtureRoot()
  const release = path.join(root, 'stamp-abc-slug')
  const web = path.join(release, 'web')
  await mkdir(path.join(web, 'assets'), { recursive: true })
  await mkdir(path.join(web, 'vscode-icons'), { recursive: true })
  await mkdir(path.join(web, 'licenses'), { recursive: true })
  await mkdir(path.join(release, 'server'), { recursive: true })
  await writeFile(path.join(web, 'licenses/index.html'), '<main>Third-party notices</main>')
  await writeFile(path.join(web, 'licenses/THIRD_PARTY_NOTICES.txt'), 'Copyright fixture web')
  await writeFile(path.join(release, 'server/THIRD_PARTY_NOTICES.txt'), 'Copyright fixture server')
  await writeFile(path.join(web, 'index.html'), appTemplate('root'))
  if (devPage) await writeFile(path.join(web, 'dev.html'), appTemplate('dev'))
  await writeFile(path.join(web, 'assets', 'index-abc.js'), 'console.log(1)')
  await writeFile(path.join(web, 'assets', 'ghostty-vt.wasm'), new Uint8Array([0, 97, 115, 109]))
  await writeFile(path.join(web, 'vscode-icons', 'code.svg'), '<svg/>')
  await writeFile(
    path.join(release, 'build-config.json'),
    JSON.stringify({ release, commit: 'abc', dirtyFiles: ['x.ts'] }),
  )
  const settings = testSettingsOptions(root)
  await mkdir(path.dirname(settings.userFilePath!), { recursive: true })
  await writeFile(settings.userFilePath!, JSON.stringify({ 'environments.devicePairing': pairing }))
  return createTestApp({
    auth: { allowedOrigins },
    system: { webBase },
    settings,
    web: { root: web, bootstrapDevelopment: development },
    workspaceRoot: root,
  })
}

function appTemplate(root: string) {
  return `<html><head><script id="${HTML_BOOTSTRAP_ID}" type="application/json"></script><style id="${HTML_BOOTSTRAP_PALETTE_ID}"></style><link id="${HTML_BOOTSTRAP_WALLPAPER_IDS.light}"><link id="${HTML_BOOTSTRAP_WALLPAPER_IDS.dark}"></head><body><div id="${root}"></div></body></html>`
}

function embedded(html: string): HtmlBootstrap {
  const json = new RegExp(`<script id="${HTML_BOOTSTRAP_ID}"[^>]*>(.*?)</script>`, 'su').exec(
    html,
  )?.[1]
  expect(json).toBeDefined()
  return JSON.parse(json!)
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
