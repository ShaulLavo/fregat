import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { Fetcher, FontSubsetter } from '../fetcher'
import { NerdFontProvider, parseNerdFontLinks } from '../nerd'

type TestZip = {
  file(name: string, data: string | Buffer): TestZip
  generateAsync(options: { type: 'arraybuffer' }): Promise<ArrayBuffer>
}
type JSZipConstructor = new () => TestZip

const require = createRequire(import.meta.url)
const JSZip = require('jszip') as JSZipConstructor
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('NerdFontProvider', () => {
  it('parses Nerd Fonts download links from the downloads page', () => {
    const links = parseNerdFontLinks(`
      <a href="https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/JetBrainsMono.zip">Download</a>
      <a href="/not-a-font.txt">Download</a>
      <a href="https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/Bad%2FName.zip">Download</a>
      <a href="https://example.com/Ignored.zip">Docs</a>
      <a href="https://example.com/Elsewhere.zip">Download</a>
    `)

    expect(links).toEqual({
      JetBrainsMono:
        'https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/JetBrainsMono.zip',
    })
  })

  it('reuses cached font links', async () => {
    const root = await fixtureRoot()
    const first = provider({
      cacheRoot: root,
      fetcher: async () => new Response(downloadsHtml(['JetBrainsMono'])),
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
    const archive = await fontArchive()
    const service = provider({
      cacheRoot: root,
      fetcher: async (input) => fontFetch(input, archive),
    })

    const font = await service.font('JetBrainsMono')

    expect(font?.toString()).toBe('regular-font')
  })

  it('rejects invalid font names before fetching', async () => {
    let fetchCount = 0
    const service = provider({
      cacheRoot: await fixtureRoot(),
      fetcher: async () => {
        fetchCount += 1
        return new Response(downloadsHtml(['JetBrainsMono']))
      },
    })

    await expect(service.font('../JetBrainsMono')).resolves.toBeNull()
    expect(fetchCount).toBe(0)
  })

  it('caches preview subsets by font and preview text', async () => {
    let subsetCount = 0
    const service = provider({
      cacheRoot: await fixtureRoot(),
      fetcher: async (input) => fontFetch(input, await fontArchive()),
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

async function fontArchive() {
  const zip = new JSZip()
  zip.file('JetBrainsMonoNerdFont-Bold.ttf', 'bold-font')
  zip.file('JetBrainsMonoNerdFont-Regular.ttf', 'regular-font')
  return zip.generateAsync({ type: 'arraybuffer' })
}

function fontFetch(input: string | URL | Request, archive: ArrayBuffer) {
  const url = String(input)
  if (url.includes('font-downloads'))
    return Promise.resolve(new Response(downloadsHtml(['JetBrainsMono'])))
  if (url.endsWith('/JetBrainsMono.zip')) return Promise.resolve(new Response(archive))

  throw new Error(`Unexpected fetch: ${url}`)
}

function downloadsHtml(names: readonly string[]) {
  return names
    .map(
      (name) =>
        `<a href="https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/${name}.zip">Download</a>`,
    )
    .join('\n')
}
