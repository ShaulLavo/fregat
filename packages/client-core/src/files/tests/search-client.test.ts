import { describe, expect, it } from 'vitest'

import type { Client } from '../../transport/client'
import { collectWorkspaceSearch, streamWorkspaceSearch } from '../search-client'

/**
 * A stream that ends without a terminal `done` is not something any current
 * server route produces, so the condition has to be supplied at the transport.
 * This injects the one route `streamWorkspaceSearch` calls rather than mocking a
 * module: the real client is a parameter, so a stand-in for it is dependency
 * injection, which is what the repo's test doctrine prescribes.
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

  // `truncated` was previously defaulted to `false` whenever `done` was absent,
  // which is what let a partial run read as a finished, untruncated one.
  it('never defaults truncated to false when the stream did not complete', async () => {
    const client = clientStreaming([match('src/a.ts')])

    await expect(collectWorkspaceSearch(QUERY, undefined, client)).rejects.toThrow()
  })

  it('rejects rather than resolving an empty result when the caller aborts', async () => {
    const controller = new AbortController()
    const client = clientStreaming([match('src/a.ts'), match('src/b.ts'), done()])

    const pending = collectWorkspaceSearch(QUERY, controller.signal, client)
    controller.abort()

    await expect(pending).rejects.toThrow()
  })

  it('rejects a done event whose payload is not an object instead of zeroing it', async () => {
    const client = clientStreaming([match('src/a.ts'), { event: 'done', data: 'nonsense' }])

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
