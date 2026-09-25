import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { FontsourceProvider } from '../fontsource'
import { CYRILLIC_RANGE, LATIN_RANGE, fontsourceRoutes, routedFetcher } from './fixtures'

const roots: string[] = []
const DAY_MS = 24 * 60 * 60 * 1000

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FontsourceProvider', () => {
  it('drops icon fonts from the catalog', async () => {
    const { provider } = await fixture()

    const ids = (await provider.catalog()).map((font) => font.id)

    expect(ids).toEqual(['geist', 'lobster'])
  })

  it('serves a cached catalog for a day, then refetches', async () => {
    let now = Date.now()
    const { provider, requests, root } = await fixture({ now: () => now })
    await provider.catalog()

    const again = new FontsourceProvider({
      ...options(root, routedFetcher({}).fetcher),
      now: () => now,
    })
    await expect(again.catalog()).resolves.toHaveLength(2)

    now += DAY_MS + 1
    const later = await fixture({ now: () => now, root })
    await later.provider.catalog()
    expect(requests).toHaveLength(1)
    expect(later.requests).toEqual(['https://api.fontsource.org/v1/fonts'])
  })

  it('serves a stale catalog when the network is gone', async () => {
    let now = Date.now()
    const { provider, root } = await fixture({ now: () => now })
    await provider.catalog()

    now += DAY_MS * 3
    const offline = new FontsourceProvider({
      ...options(root, routedFetcher({}).fetcher),
      now: () => now,
    })

    await expect(offline.catalog()).resolves.toHaveLength(2)
  })

  it('declares one variable face per subset and style, with its unicode-range', async () => {
    const { provider } = await fixture()

    const css = await provider.stylesheet('geist')

    expect(faces(css)).toEqual([
      {
        family: '"geist Fontsource"',
        range: CYRILLIC_RANGE,
        src: 'geist/cyrillic-wght-italic.woff2',
        weight: '100 900',
      },
      {
        family: '"geist Fontsource"',
        range: CYRILLIC_RANGE,
        src: 'geist/cyrillic-wght-normal.woff2',
        weight: '100 900',
      },
      {
        family: '"geist Fontsource"',
        range: LATIN_RANGE,
        src: 'geist/latin-wght-italic.woff2',
        weight: '100 900',
      },
      {
        family: '"geist Fontsource"',
        range: LATIN_RANGE,
        src: 'geist/latin-wght-normal.woff2',
        weight: '100 900',
      },
    ])
  })

  it('declares only the weights a static font has among the ones the app uses', async () => {
    const { provider } = await fixture()

    const css = await provider.stylesheet('lobster')

    expect(faces(css).map((face) => face.src)).toEqual(['lobster/latin-400-normal.woff2'])
  })

  it('downloads a file once and serves it from the cache after', async () => {
    const { provider, requests, root } = await fixture()

    await expect(provider.file('geist', 'latin-wght-normal.woff2')).resolves.toEqual(
      Buffer.from('geist-latin-wght'),
    )
    const offline = new FontsourceProvider(options(root, routedFetcher({}).fetcher))
    await expect(offline.file('geist', 'latin-wght-normal.woff2')).resolves.toEqual(
      Buffer.from('geist-latin-wght'),
    )
    expect(requests.filter((url) => url.includes('cdn.jsdelivr.net'))).toHaveLength(1)
  })

  it('rejects a font outside the catalog and a file the stylesheet does not name', async () => {
    const { provider, requests } = await fixture()

    await expect(provider.stylesheet('not-a-font')).resolves.toBeNull()
    await expect(provider.file('not-a-font', 'latin-400-normal.woff2')).resolves.toBeNull()
    await expect(provider.file('geist', 'latin-300-normal.woff2')).resolves.toBeNull()
    await expect(provider.file('geist', 'greek-wght-normal.woff2')).resolves.toBeNull()
    await expect(provider.file('geist', '../catalog.json')).resolves.toBeNull()
    expect(requests.filter((url) => url.includes('cdn.jsdelivr.net'))).toEqual([])
  })

  it('subsets a preview from the static latin regular file', async () => {
    const subsets: string[] = []
    const { provider } = await fixture({
      subsetter: async (font, text) => {
        subsets.push(`${font.toString()}:${text}`)
        return Buffer.from('preview')
      },
    })

    await provider.preview('geist', 'Abc', 'hash')
    await provider.preview('geist', 'Abc', 'hash')

    expect(subsets).toEqual(['geist-latin-400:Abc'])
  })
})

type FixtureOptions = {
  now?: () => number
  root?: string
  subsetter?: (font: Buffer, text: string) => Promise<Buffer>
}

async function fixture(overrides: FixtureOptions = {}) {
  const root = overrides.root ?? (await fixtureRoot())
  const { fetcher, requests } = routedFetcher(fontsourceRoutes())
  const provider = new FontsourceProvider({
    ...options(root, fetcher),
    ...(overrides.subsetter ? { subsetter: overrides.subsetter } : {}),
    now: overrides.now,
  })
  return { provider, requests, root }
}

function options(cacheRoot: string, fetcher: ReturnType<typeof routedFetcher>['fetcher']) {
  return { cacheRoot, fetcher, subsetter: async () => Buffer.from('unused') }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-fontsource-'))
  roots.push(root)
  return root
}

function faces(css: string | null) {
  const blocks = css?.split('@font-face').slice(1) ?? []
  return blocks
    .map((block) => ({
      family: /font-family: ([^;]+);/u.exec(block)?.[1],
      range: /unicode-range: ([^;]+);/u.exec(block)?.[1],
      src: /url\("([^"]+)"\)/u.exec(block)?.[1],
      weight: /font-weight: ([^;]+);/u.exec(block)?.[1],
    }))
    .sort((left, right) => String(left.src).localeCompare(String(right.src)))
}
