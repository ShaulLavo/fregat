import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { fontQueryOptions } from '@/lib/fonts/state/queries'

const url = (path: string) => `http://server.test/${path}`
const NERD_FAMILY = 'JetBrainsMono Nerd Font'

describe('fontQueryOptions', () => {
  it('registers one URL-sourced face for a Nerd Font and loads it', async () => {
    const state = fontState()
    const family = await client().fetchQuery(fontQueryOptions('nerd:JetBrainsMono', state))

    expect(family).toBe(NERD_FAMILY)
    expect(state.faces).toHaveLength(1)
    expect(state.faces[0]?.source).toBe('url("http://server.test/fonts/nerd/JetBrainsMono")')
    expect(state.faces[0]?.status).toBe('loaded')
  })

  it('joins a second request for the same ref instead of loading it again', async () => {
    const state = fontState()
    const queries = client()
    await Promise.all([
      queries.fetchQuery(fontQueryOptions('nerd:JetBrainsMono', state)),
      queries.fetchQuery(fontQueryOptions('nerd:JetBrainsMono', state)),
    ])

    expect(state.created).toBe(1)
  })

  it('adopts the face the boot script already started', async () => {
    const state = fontState()
    const started = state.startFace(`"${NERD_FAMILY}"`, 'url("boot")')
    state.faces.push(started)
    await client().fetchQuery(fontQueryOptions('nerd:JetBrainsMono', state))

    expect(state.created).toBe(1)
    expect(started.status).toBe('loaded')
  })

  it('replaces a started face that failed', async () => {
    const state = fontState()
    const failed = state.startFace(NERD_FAMILY, 'url("http://gone.test/font")')
    failed.fail()
    state.faces.push(failed)
    await client().fetchQuery(fontQueryOptions('nerd:JetBrainsMono', state))

    expect(state.faces).toHaveLength(1)
    expect(state.faces[0]).not.toBe(failed)
  })

  it('links the Fontsource stylesheet once and waits for the family', async () => {
    const state = fontState()
    const loading = client().fetchQuery(fontQueryOptions('fontsource:geist', state))
    await Promise.resolve()
    const link = state.links[0]
    link?.dispatchEvent(new Event('load'))

    await expect(loading).resolves.toBe('geist Fontsource')
    expect(state.links).toHaveLength(1)
    expect(link?.href).toBe('http://server.test/fonts/fontsource/geist.css')
    expect(state.loads).toEqual(['1em "geist Fontsource"'])
  })

  it('adopts a stylesheet boot already loaded', async () => {
    const state = fontState()
    const link = document.createElement('link')
    link.dataset.fontRef = 'fontsource:geist'
    link.dataset.state = 'loaded'
    state.links.push(link)

    await client().fetchQuery(fontQueryOptions('fontsource:geist', state))

    expect(state.links).toHaveLength(1)
  })

  it('needs no download for a bundled font', async () => {
    const state = fontState()

    await expect(client().fetchQuery(fontQueryOptions('bundled:inter', state))).resolves.toBe(
      'Inter Variable',
    )
    expect(state.created).toBe(0)
    expect(state.links).toHaveLength(0)
  })

  it('resolves an installed font the server lacks to the local family', async () => {
    const state = fontState({ faces: [] })
    const loading = client().fetchQuery(fontQueryOptions('local:Berkeley Mono', state))
    await Promise.resolve()
    state.links[0]?.dispatchEvent(new Event('load'))

    await expect(loading).resolves.toBe('Berkeley Mono')
    expect(state.links[0]?.href).toBe('http://server.test/fonts/local/Berkeley%20Mono.css')
  })

  it('resolves to null when font loading is unsupported', async () => {
    const options = fontQueryOptions('nerd:JetBrainsMono', { FontFace: null, fonts: null })

    expect(await client().fetchQuery(options)).toBeNull()
  })
})

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function fontState({ faces: loadedFaces = [{} as FontFace] } = {}) {
  const faces: TestFontFace[] = []
  const links: HTMLLinkElement[] = []
  const loads: string[] = []
  const counter = { created: 0 }

  class TestFontFace {
    status: FontFaceLoadStatus = 'unloaded'

    constructor(
      readonly family: string,
      readonly source: string,
    ) {
      counter.created += 1
    }

    fail() {
      this.status = 'error'
    }

    async load() {
      this.status = 'loaded'
      return this
    }
  }

  return {
    get created() {
      return counter.created
    },
    FontFace: TestFontFace as unknown as typeof FontFace,
    startFace: (family: string, source: string) => new TestFontFace(family, source),
    faces,
    links,
    loads,
    fonts: {
      add: (face: FontFace) => faces.push(face as unknown as TestFontFace),
      delete: (face: FontFace) => faces.splice(faces.indexOf(face as unknown as TestFontFace), 1),
      load: async (font: string) => {
        loads.push(font)
        return loadedFaces
      },
      [Symbol.iterator]: () => (faces as unknown as FontFace[])[Symbol.iterator](),
    },
    document: {
      createElement: (tag: string) => document.createElement(tag),
      querySelector: (selector: string) =>
        links.find((link) => selector.includes(JSON.stringify(link.dataset.fontRef))) ?? null,
      head: { append: (link: HTMLLinkElement) => links.push(link) },
    } as never,
    url,
  }
}
