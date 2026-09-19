import { describe, expect, it } from 'vitest'

import type { Client } from '../../transport/client'
import { collectWorkspaceSearch, streamWorkspaceSearch } from '../search-client'

/**
 * No server route ends a stream without `done`, so the condition is supplied at
 * the transport. `client` is a real parameter, so this is injection, not mocking.
 */
function clientStreaming(chunks: readonly unknown[]): Client {
  async function* stream() {
    for (const chunk of chunks) yield chunk
  }

  return {
    fs: { search: { events: { get: async () => ({ data: stream(), error: null, status: 200 }) } } },
  } as unknown as Client
}

const QUERY = {
  caseSensitive: false,
  includeContent: true,
  includeNames: true,
  limit: 50,
  matchMode: 'literal' as const,
  path: 'src',
  query: 'needle',
  wholeWord: false,
}

function match(path: string) {
  return {
    event: 'match',
    data: {
      match: {
        column: 1,
        kind: 'content',
        line: 1,
        path,
        preview: 'needle',
        source: 'disk',
        type: 'file',
      },
    },
  }
}

function done(overrides: Record<string, unknown> = {}) {
  return {
    event: 'done',
    data: { count: 1, fileCount: 1, path: 'src', query: 'needle', truncated: false, ...overrides },
  }
}

describe('collectWorkspaceSearch', () => {
  it('review: rejects a done object missing completion fields', async () => {
    const client = clientStreaming([match('src/a.ts'), { event: 'done', data: {} }])
    await expect(collectWorkspaceSearch(QUERY, undefined, client)).rejects.toThrow(
      /invalid completion event/u,
    )
  })

  it('rejects a stream that ends after matches without a terminal done', async () => {
    const client = clientStreaming([match('src/a.ts'), match('src/b.ts')])

    await expect(collectWorkspaceSearch(QUERY, undefined, client)).rejects.toThrow(
      /ended after 2 matches without completing/u,
    )
  })

  it('resolves a complete stream and reports the server counts, not the match count', async () => {
    const client = clientStreaming([match('src/a.ts'), done({ count: 9, truncated: true })])

    const result = await collectWorkspaceSearch(QUERY, undefined, client)

    expect(result.count).toBe(9)
    expect(result.matches).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  // A defaulted `truncated: false` is what let a partial run read as finished.
  it('never defaults truncated to false when the stream did not complete', async () => {
    const client = clientStreaming([match('src/a.ts')])

    await expect(collectWorkspaceSearch(QUERY, undefined, client)).rejects.toThrow()
  })

  it('rejects rather than resolving an empty result when the caller aborts', async () => {
    const controller = new AbortController()
    const client = clientStreaming([match('src/a.ts'), match('src/b.ts'), done()])

    const pending = collectWorkspaceSearch(QUERY, controller.signal, client)
    controller.abort()

    // Names the mechanism: a bare `toThrow()` also passes for a missing `done`.
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects a done event whose payload is not an object instead of zeroing it', async () => {
    const client = clientStreaming([match('src/a.ts'), { event: 'done', data: 'nonsense' }])

    await expect(collectWorkspaceSearch(QUERY, undefined, client)).rejects.toThrow(
      /invalid completion event/u,
    )
  })

  // Checking only the wrapper is not enough: the property helpers default a
  // missing field, so each of these would otherwise read as a complete,
  // untruncated run — the exact fabrication the guard exists to stop.
  it.each([
    ['empty object', {}],
    ['missing truncated', { count: 1, path: 'src', query: 'needle' }],
    ['truncated not boolean', { count: 1, path: 'src', query: 'needle', truncated: 'no' }],
    ['count not a number', { count: '1', path: 'src', query: 'needle', truncated: false }],
    ['missing path', { count: 1, query: 'needle', truncated: false }],
  ])('rejects a done payload with %s', async (_label, data) => {
    const client = clientStreaming([match('src/a.ts'), { event: 'done', data }])

    await expect(collectWorkspaceSearch(QUERY, undefined, client)).rejects.toThrow(
      /invalid completion event/u,
    )
  })
})

describe('streamWorkspaceSearch', () => {
  it('yields every event before throwing, so a consumer sees the partial set it must discard', async () => {
    const client = clientStreaming([match('src/a.ts'), match('src/b.ts')])
    const seen: string[] = []

    await expect(async () => {
      for await (const event of streamWorkspaceSearch(QUERY, undefined, client))
        seen.push(event.type)
    }).rejects.toThrow(/without completing/u)

    expect(seen).toEqual(['match', 'match'])
  })

  it('does not throw when the stream completes', async () => {
    const client = clientStreaming([match('src/a.ts'), done()])
    const seen: string[] = []

    for await (const event of streamWorkspaceSearch(QUERY, undefined, client)) seen.push(event.type)

    expect(seen).toEqual(['match', 'done'])
  })
})
