import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { Fetcher, FontSubsetter } from '../fetcher'
import { NerdFontProvider, parseNerdFontLinks } from '../nerd'

import { nerdRelease, nerdArchive } from './fixtures'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('NerdFontProvider', () => {
  it('accepts only ZIP assets from Nerd Fonts releases', () => {
    const release = nerdRelease(['JetBrainsMono', 'Bad%2FName'])
    release.assets.push(
      { browser_download_url: 'https://example.com/Elsewhere.zip' },
      { browser_download_url: 'https://github.com/another/repo/releases/download/v1/Bad.zip' },
      { browser_download_url: 'not-a-url' },
      {
        browser_download_url: 'http://github.com/ryanoasis/nerd-fonts/releases/download/v1/Bad.zip',
      },
      {
        browser_download_url:
          'https://github.com/ryanoasis/nerd-fonts/releases/download/v1/Bad.tar.xz',
      },
    )
    expect(parseNerdFontLinks(release)).toEqual({
      JetBrainsMono:
        'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/JetBrainsMono.zip',
    })
  })

  it('rejects malformed release metadata', () => {
    expect(() => parseNerdFontLinks({ assets: [{ name: 'font.zip' }] })).toThrow()
  })

  it('reuses cached font links', async () => {
    const root = await fixtureRoot()
    const first = provider({
      cacheRoot: root,
      fetcher: async () => Response.json(nerdRelease(['JetBrainsMono'])),
    })

    await expect(first.links()).resolves.toHaveProperty('JetBrainsMono')

    const second = provider({
      cacheRoot: root,
      fetcher: async () => {
        throw new Error('cache miss')
      },
    })

    await expect(second.links()).resolves.toHaveProperty('JetBrainsMono')
  })

  it('extracts the regular font from a downloaded archive', async () => {
    const root = await fixtureRoot()
    const archive = nerdArchive()
    const service = provider({
      cacheRoot: root,
      fetcher: async (input) => fontFetch(input, archive),
    })

    const font = await service.font('JetBrainsMono')

    expect(font?.toString()).toBe('regular-font')
  })

  it('downloads one archive for concurrent asks of a cold font', async () => {
    const root = await fixtureRoot()
    const archive = nerdArchive()
    let downloads = 0
    const service = provider({
      cacheRoot: root,
      fetcher: async (input) => {
        if (String(input).endsWith('.zip')) downloads += 1
        return fontFetch(input, archive)
      },
    })

    await Promise.all([service.font('JetBrainsMono'), service.font('JetBrainsMono')])

    expect(downloads).toBe(1)
  })

  it('downloads a face without the rate-limited release API', async () => {
    const requests: string[] = []
    const service = provider({
      cacheRoot: await fixtureRoot(),
      fetcher: async (input) => {
        requests.push(String(input))
        if (String(input).includes('api.github.com'))
          return new Response('rate limited', { status: 403 })
        return fontFetch(input, nerdArchive())
      },
    })

    await expect(service.font('JetBrainsMono')).resolves.toEqual(Buffer.from('regular-font'))
    expect(requests).toEqual([
      'https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip',
    ])
  })

  it('answers null for a face the release does not have', async () => {
    const service = provider({
      cacheRoot: await fixtureRoot(),
      fetcher: async () => new Response('Not Found', { status: 404 }),
    })

    await expect(service.font('NoSuchFont')).resolves.toBeNull()
  })

  it.each([
    ['upstream denial', async () => new Response('denied', { status: 403 }), 'download'],
    [
      'transport failure',
      async () => {
        throw new TypeError('fetch failed')
      },
      'download',
    ],
    ['invalid archive', async () => new Response('invalid archive'), 'archive'],
  ] as const)('reports %s as a structured unavailable font', async (_, fetcher, stage) => {
    const service = provider({ cacheRoot: await fixtureRoot(), fetcher })
    await expect(service.font('NerdFontsSymbolsOnly')).rejects.toMatchObject({
      code: 'fonts.UNAVAILABLE',
      statusCode: 503,
      internal: expect.objectContaining({ stage }),
      why: expect.stringMatching(/\S/),
      fix: expect.stringMatching(/\S/),
    })
  })

  it('rejects invalid font names before fetching', async () => {
    let fetchCount = 0
    const service = provider({
      cacheRoot: await fixtureRoot(),
      fetcher: async () => {
        fetchCount += 1
        return Response.json(nerdRelease(['JetBrainsMono']))
      },
    })

    await expect(service.font('../JetBrainsMono')).resolves.toBeNull()
    expect(fetchCount).toBe(0)
  })

  it('caches preview subsets by font and preview text', async () => {
    let subsetCount = 0
    const service = provider({
      cacheRoot: await fixtureRoot(),
      fetcher: async (input) => fontFetch(input, nerdArchive()),
      subsetter: async (font, text) => {
        subsetCount += 1
        return Buffer.from(`subset:${text}:${font.toString()}`)
      },
    })

    await expect(service.preview('JetBrainsMono', 'ABC', 'abc')).resolves.toEqual(
      Buffer.from('subset:ABC:regular-font'),
    )
    await expect(service.preview('JetBrainsMono', 'ABC', 'abc')).resolves.toEqual(
      Buffer.from('subset:ABC:regular-font'),
    )
    expect(subsetCount).toBe(1)
  })
})

function provider(options: { cacheRoot: string; fetcher: Fetcher; subsetter?: FontSubsetter }) {
  return new NerdFontProvider({
    subsetter: async () => Buffer.from('unused'),
    ...options,
  })
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-fonts-'))
  roots.push(root)
  return root
}

function fontFetch(input: string | URL | Request, archive: ArrayBuffer) {
  const url = String(input)
  if (url.endsWith('/releases/latest'))
    return Promise.resolve(Response.json(nerdRelease(['JetBrainsMono'])))
  if (url.endsWith('/releases/latest/download/JetBrainsMono.zip'))
    return Promise.resolve(new Response(archive))

  throw new Error(`Unexpected fetch: ${url}`)
}
