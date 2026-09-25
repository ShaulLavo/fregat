import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Elysia } from 'elysia'

import { FontCatalogService } from '../catalog'
import { fontRoutes } from '../routes'
import { fontsourceRoutes, routedFetcher } from './fixtures'

const roots: string[] = []
const NERD_ZIP =
  'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/JetBrainsMono.zip'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('fontRoutes', () => {
  it('lists both providers in one catalog', async () => {
    const { app } = await testApp()

    const response = await app.handle(new Request('http://local/fonts'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        ref: 'local:Berkeley Mono',
        family: 'Berkeley Mono',
        source: 'local',
        category: 'monospace',
        variable: false,
        weights: [400],
        license: null,
      },
      {
        ref: 'nerd:JetBrainsMono',
        family: 'JetBrainsMono Nerd Font',
        source: 'nerd',
        category: 'monospace',
        variable: false,
        weights: [400],
        license: null,
      },
      {
        ref: 'fontsource:geist',
        family: 'Geist',
        source: 'fontsource',
        category: 'sans-serif',
        variable: true,
        weights: [100, 400, 500, 600, 700, 900],
        license: 'OFL-1.1',
      },
      {
        ref: 'fontsource:lobster',
        family: 'Lobster',
        source: 'fontsource',
        category: 'display',
        variable: false,
        weights: [400],
        license: 'OFL-1.1',
      },
    ])
  })

  it('still lists Nerd Fonts when Fontsource is unreachable', async () => {
    const { app } = await testApp({ fontsource: false })

    const response = await app.handle(new Request('http://local/fonts'))

    expect((await response.json()).map((font: { ref: string }) => font.ref)).toEqual([
      'local:Berkeley Mono',
      'nerd:JetBrainsMono',
    ])
  })

  it('serves a generated stylesheet whose faces resolve beside it', async () => {
    const { app } = await testApp()

    const css = await app.handle(new Request('http://local/fonts/fontsource/geist.css'))
    const body = await css.text()
    const file = await app.handle(
      new Request(
        new URL('geist/latin-wght-normal.woff2', 'http://local/fonts/fontsource/geist.css'),
      ),
    )

    expect(css.headers.get('content-type')).toBe('text/css')
    expect(body).toContain('url("geist/latin-wght-normal.woff2")')
    expect(file.status).toBe(200)
    expect(file.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await file.text()).toBe('geist-latin-wght')
  })

  it('serves an installed font beside its stylesheet, and an empty one for a family it lacks', async () => {
    const { app } = await testApp()

    const css = await app.handle(new Request('http://local/fonts/local/Berkeley%20Mono.css'))
    const body = await css.text()
    const file = await app.handle(
      new Request(new URL('Berkeley%20Mono/0', 'http://local/fonts/local/Berkeley%20Mono.css')),
    )
    const missing = await app.handle(new Request('http://local/fonts/local/Comic%20Sans.css'))

    expect(body).toContain('font-family: "Berkeley Mono";')
    expect(body).toContain('url("Berkeley%20Mono/0")')
    expect(file.headers.get('content-type')).toBe('font/otf')
    expect(await file.text()).toBe('installed-font')
    expect(missing.status).toBe(200)
    expect(await missing.text()).toBe('')
  })

  it('serves a Nerd Font as ttf', async () => {
    const { app } = await testApp()

    const response = await app.handle(new Request('http://local/fonts/nerd/JetBrainsMono'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('font/ttf')
    expect(await response.text()).toBe('regular-font')
  })

  it('previews any catalog ref', async () => {
    const { app } = await testApp()

    const nerd = await app.handle(
      new Request('http://local/fonts/preview?ref=nerd:JetBrainsMono&text=ABC'),
    )
    const fontsource = await app.handle(
      new Request('http://local/fonts/preview?ref=fontsource:geist&text=ABC'),
    )

    expect(nerd.headers.get('content-type')).toBe('font/woff2')
    expect(await nerd.text()).toBe('subset:ABC:regular-font')
    expect(await fontsource.text()).toBe('subset:ABC:geist-latin-400')
  })

  it('returns structured not found errors for refs outside the catalog', async () => {
    const { app } = await testApp()

    const responses = await Promise.all(
      [
        '/fonts/nerd/MissingFont',
        '/fonts/fontsource/missing.css',
        '/fonts/fontsource/geist/latin-300-normal.woff2',
        '/fonts/preview?ref=local:Comic%20Sans',
        '/fonts/local/Berkeley%20Mono/7',
      ].map((url) => app.handle(new Request(`http://local${url}`))),
    )

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404])
    expect(await responses[0]?.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'font not found' },
    })
  })
})

const FC_LIST = 'Berkeley Mono\t80\t0\t100\t/fonts/BerkeleyMono-Regular.otf\n'

async function testApp({ fontsource = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-font-routes-'))
  roots.push(root)
  const archive = await nerdArchive()
  const { fetcher } = routedFetcher({
    'https://www.nerdfonts.com/font-downloads': () =>
      new Response(`<a href="${NERD_ZIP}">Download</a>`),
    [NERD_ZIP]: () => new Response(archive),
    ...(fontsource ? fontsourceRoutes() : {}),
  })
  const fonts = new FontCatalogService({
    cacheRoot: root,
    fetcher,
    subsetter: async (font, text) => Buffer.from(`subset:${text}:${font.toString()}`),
    listInstalled: async () => FC_LIST,
    readInstalled: async () => Buffer.from('installed-font'),
  })
  return { app: new Elysia().use(fontRoutes(fonts)) }
}

async function nerdArchive() {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('JetBrainsMonoNerdFont-Regular.ttf', 'regular-font')
  return zip.generateAsync({ type: 'arraybuffer' })
}
