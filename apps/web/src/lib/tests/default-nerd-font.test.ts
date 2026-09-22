import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { DEFAULT_NERD_FONT_FAMILY, nerdFontQueryOptions } from '../default-nerd-font'

const url = 'http://server.test/fonts/JetBrainsMono'

describe('nerdFontQueryOptions', () => {
  it('registers one URL-sourced face and loads it', async () => {
    const state = fontState()
    const family = await client().fetchQuery(nerdFontQueryOptions('JetBrainsMono', state))

    expect(family).toBe(DEFAULT_NERD_FONT_FAMILY)
    expect(state.faces).toHaveLength(1)
    expect(state.faces[0]?.source).toBe(`url("${url}")`)
    expect(state.faces[0]?.status).toBe('loaded')
  })

  it('joins a second request for the same family instead of loading it again', async () => {
    const state = fontState()
    const queries = client()
    await Promise.all([
      queries.fetchQuery(nerdFontQueryOptions('JetBrainsMono', state)),
      queries.fetchQuery(nerdFontQueryOptions('JetBrainsMono', state)),
    ])

    expect(state.created).toBe(1)
  })

  it('adopts the face index.html already started', async () => {
    const state = fontState()
    const started = state.startFace(`"${DEFAULT_NERD_FONT_FAMILY}"`, `url("${url}")`)
    state.faces.push(started)
    await client().fetchQuery(nerdFontQueryOptions('JetBrainsMono', state))

    expect(state.created).toBe(1)
    expect(started.status).toBe('loaded')
  })

  it('replaces a started face that failed', async () => {
    const state = fontState()
    const failed = state.startFace(DEFAULT_NERD_FONT_FAMILY, 'url("http://gone.test/font")')
    failed.fail()
    state.faces.push(failed)
    await client().fetchQuery(nerdFontQueryOptions('JetBrainsMono', state))

    expect(state.faces).toHaveLength(1)
    expect(state.faces[0]).not.toBe(failed)
  })

  it('resolves to null when font loading is unsupported', async () => {
    const options = nerdFontQueryOptions('JetBrainsMono', { FontFace: null, fonts: null })

    expect(await client().fetchQuery(options)).toBeNull()
  })
})

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function fontState() {
  const faces: TestFontFace[] = []
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
    fonts: {
      add: (face: FontFace) => faces.push(face as unknown as TestFontFace),
      delete: (face: FontFace) => faces.splice(faces.indexOf(face as unknown as TestFontFace), 1),
      [Symbol.iterator]: () => (faces as unknown as FontFace[])[Symbol.iterator](),
    },
    url,
  }
}
