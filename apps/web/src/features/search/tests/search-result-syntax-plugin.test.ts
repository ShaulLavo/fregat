import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  type PieceTableSnapshot,
} from '@singapore-editor/core/document'
import {
  createEmptySyntaxResult,
  type EditorSyntaxProvider,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
  type EditorSyntaxSessionOptions,
  type EditorToken,
} from '@singapore-editor/core/syntax'
import { describe } from 'vitest'

import { expect, test as it } from '../../../../test/fixtures'

import { createSearchResultSyntaxProvider } from '@/features/search/utils/result-syntax-plugin'
import { SearchResultSyntaxCache } from '@/features/search/state/result-syntax-cache'

type RecordingSyntaxState = {
  documentIds: string[]
  parsedTexts: string[]
  sessionCount: number
}

describe('search result syntax provider', () => {
  it('parses search result excerpts independently and offsets their tokens', async () => {
    const recording = recordingSyntaxState()
    const provider = createSearchResultSyntaxProvider(recordingSyntaxProvider(recording))
    const text = 'const created = app.handle(\nconst created = await app.handle('
    const snapshot = createPieceTableSnapshot(text)
    const session = searchResultSession(provider, snapshot, text)

    expect(session.foldingSupport).toBe('unsupported')
    const result = await session.refresh(snapshot, text)

    expect(recording.sessionCount).toBe(2)
    expect(new Set(recording.documentIds).size).toBe(2)
    expect(recording.parsedTexts).toEqual([
      'const created = app.handle(',
      'const created = await app.handle(',
    ])
    expect(result.tokens).toEqual([
      syntaxToken(0, 5),
      syntaxToken(
        'const created = app.handle(\n'.length,
        'const created = app.handle(\n'.length + 5,
      ),
    ])
  })

  it('does not handle normal editor documents', () => {
    const provider = createSearchResultSyntaxProvider(
      recordingSyntaxProvider(recordingSyntaxState()),
    )
    const snapshot = createPieceTableSnapshot('const value = 1')

    expect(
      provider.createSession({
        documentId: 'workspace-file:test.ts',
        fullText: 'const value = 1',
        languageId: 'typescript',
        snapshot,
        textSnapshot: createDocumentTextSnapshot(snapshot, 'const value = 1'),
      }),
    ).toBeNull()
  })

  it('keeps provider token ranges unchanged after line-local offsets are applied', async () => {
    const text = 'const createSystem = vi.hoisted(() => vi.fn())'
    const tokens = [syntaxToken(0, 5), syntaxToken(6, 18)]
    const provider = createSearchResultSyntaxProvider(tokenSyntaxProvider(tokens))
    const snapshot = createPieceTableSnapshot(text)
    const session = searchResultSession(provider, snapshot, text)

    const result = await session.refresh(snapshot, text)

    expect(result.tokens).toEqual(tokens)
  })

  it('reuses exact excerpts across overlapping windows and remounted providers', async () => {
    const recording = recordingSyntaxState()
    const source = recordingSyntaxProvider(recording)
    const provider = createSearchResultSyntaxProvider(source)
    const firstText = 'const first = 1\nconst second = 2'
    const firstSnapshot = createPieceTableSnapshot(firstText)
    const session = searchResultSession(provider, firstSnapshot, firstText)
    await session.refresh(firstSnapshot, firstText)

    const nextText = 'const second = 2\nconst third = 3'
    await session.refresh(createPieceTableSnapshot(nextText), nextText)
    session.dispose()

    const remounted = createSearchResultSyntaxProvider(source)
    const lastText = 'const third = 3\nconst first = 1'
    const lastSnapshot = createPieceTableSnapshot(lastText)
    const lastSession = searchResultSession(remounted, lastSnapshot, lastText)
    const result = await lastSession.refresh(lastSnapshot, lastText)

    expect(recording.parsedTexts).toEqual([
      'const first = 1',
      'const second = 2',
      'const third = 3',
    ])
    expect(result.tokens).toEqual([
      syntaxToken(0, 5),
      syntaxToken('const third = 3\n'.length, 'const third = 3\n'.length + 5),
    ])
    lastSession.dispose()
  })

  it('stops obsolete excerpts and disposes the pending parser when unmounted', async () => {
    const recording = controlledSyntaxState()
    const provider = createSearchResultSyntaxProvider(controlledSyntaxProvider(recording))
    const text = 'const first = 1\nconst obsolete = 2'
    const snapshot = createPieceTableSnapshot(text)
    const session = searchResultSession(provider, snapshot, text)
    const pending = session.refresh(snapshot, text)

    session.dispose()
    expect(recording.disposedTexts).toEqual(['const first = 1'])
    recording.finish('const first = 1')
    await pending

    expect(recording.parsedTexts).toEqual(['const first = 1'])
  })

  it('stops an older window before starting its next excerpt', async () => {
    const recording = controlledSyntaxState()
    const provider = createSearchResultSyntaxProvider(controlledSyntaxProvider(recording))
    const previousText = 'const old = 1\nconst obsolete = 2'
    const previousSnapshot = createPieceTableSnapshot(previousText)
    const session = searchResultSession(provider, previousSnapshot, previousText)
    const previous = session.refresh(previousSnapshot, previousText)
    const nextText = 'const current = 3\nconst next = 4'
    const next = session.refresh(createPieceTableSnapshot(nextText), nextText)

    expect(recording.disposedTexts).toEqual(['const old = 1'])
    recording.finish('const old = 1')
    await previous
    recording.finish('const current = 3')
    await expect.poll(() => recording.parsedTexts).toContain('const next = 4')
    recording.finish('const next = 4')
    const result = await next

    expect(recording.parsedTexts).toEqual(['const old = 1', 'const current = 3', 'const next = 4'])
    expect(result.tokens).toEqual([
      syntaxToken(0, 5),
      syntaxToken('const current = 3\n'.length, 'const current = 3\n'.length + 5),
    ])
    session.dispose()
  })

  it('shares an in-flight excerpt until its last reader releases it', async () => {
    const recording = controlledSyntaxState()
    const source = controlledSyntaxProvider(recording)
    const text = 'const shared = 1'
    const snapshot = createPieceTableSnapshot(text)
    const first = searchResultSession(createSearchResultSyntaxProvider(source), snapshot, text)
    const second = searchResultSession(createSearchResultSyntaxProvider(source), snapshot, text)
    const firstRefresh = first.refresh(snapshot, text)
    const secondRefresh = second.refresh(snapshot, text)

    first.dispose()
    expect(recording.disposedTexts).toEqual([])
    expect(recording.parsedTexts).toEqual([text])
    recording.finish(text)
    await firstRefresh
    expect((await secondRefresh).tokens).toEqual([syntaxToken(0, 5)])
    expect(recording.disposedTexts).toEqual([text])
    second.dispose()
  })

  it('evicts old excerpts while retaining recently reused tokens', async () => {
    const recording = recordingSyntaxState()
    const cache = new SearchResultSyntaxCache(recordingSyntaxProvider(recording), 2)

    await readCachedExcerpt(cache, 'const first = 1')
    await readCachedExcerpt(cache, 'const second = 2')
    await readCachedExcerpt(cache, 'const first = 1')
    await readCachedExcerpt(cache, 'const third = 3')
    await readCachedExcerpt(cache, 'const first = 1')
    await readCachedExcerpt(cache, 'const second = 2')

    expect(recording.parsedTexts).toEqual([
      'const first = 1',
      'const second = 2',
      'const third = 3',
      'const second = 2',
    ])
  })

  it('does not reuse tokens across languages or highlight options', async () => {
    const recording = recordingSyntaxState()
    const cache = new SearchResultSyntaxCache(recordingSyntaxProvider(recording))
    const options = { documentId: 'search-result-file:test.ts', text: 'const value = 1' }
    const variants = [
      { ...options, languageId: 'typescript' },
      { ...options, languageId: 'javascript' },
      { ...options, languageId: 'typescript', includeHighlights: false },
      { ...options, languageId: 'typescript', includeCaptures: true },
    ]
    for (const variant of variants) {
      const lease = cache.acquire(variant)
      await lease.result
      lease.release()
    }

    expect(recording.sessionCount).toBe(4)
  })
})

async function readCachedExcerpt(cache: SearchResultSyntaxCache, text: string): Promise<void> {
  const lease = cache.acquire({
    documentId: 'search-result-file:test.ts',
    languageId: 'typescript',
    text,
  })
  await lease.result
  lease.release()
}

type ControlledSyntaxState = {
  disposedTexts: string[]
  parsedTexts: string[]
  pending: Map<string, () => void>
  finish: (text: string) => void
}

function controlledSyntaxState(): ControlledSyntaxState {
  const pending = new Map<string, () => void>()
  return {
    disposedTexts: [],
    parsedTexts: [],
    pending,
    finish(text: string) {
      expect(pending.has(text)).toBe(true)
      pending.get(text)?.()
    },
  }
}

function controlledSyntaxProvider(recording: ControlledSyntaxState): EditorSyntaxProvider {
  return {
    createSession: (options) => controlledSyntaxSession(options, recording),
  }
}

function controlledSyntaxSession(
  options: EditorSyntaxSessionOptions,
  recording: ControlledSyntaxState,
): EditorSyntaxSession {
  let parsedText = ''
  let result = createLineSyntaxResult(options.snapshot, options.fullText)
  return {
    foldingSupport: 'unsupported',
    refresh: (snapshot, text = options.fullText) => {
      parsedText = text
      recording.parsedTexts.push(text)
      const pending = Promise.withResolvers<EditorSyntaxResult>()
      recording.pending.set(text, () => {
        result = createLineSyntaxResult(snapshot, text)
        pending.resolve(result)
      })
      return pending.promise
    },
    applyChange: async () => result,
    dispose: () => recording.disposedTexts.push(parsedText),
    getResult: () => result,
    getSnapshotVersion: () => 0,
    getTokens: () => result.tokens,
  }
}

function recordingSyntaxProvider(recording: RecordingSyntaxState): EditorSyntaxProvider {
  return {
    createSession: (options) => {
      recording.sessionCount += 1
      recording.documentIds.push(options.documentId)
      return recordingSyntaxSession(options, recording)
    },
  }
}

function recordingSyntaxState(): RecordingSyntaxState {
  return {
    documentIds: [],
    parsedTexts: [],
    sessionCount: 0,
  }
}

function searchResultSession(
  provider: EditorSyntaxProvider,
  snapshot: PieceTableSnapshot,
  text: string,
): EditorSyntaxSession {
  const session = provider.createSession({
    documentId: 'search-result-file:test.ts',
    fullText: text,
    languageId: 'typescript',
    snapshot,
    textSnapshot: createDocumentTextSnapshot(snapshot, text),
  })

  if (!session) throw new Error('Expected search result syntax session')

  return session
}

function recordingSyntaxSession(
  options: EditorSyntaxSessionOptions,
  recording: RecordingSyntaxState,
): EditorSyntaxSession {
  let result = createLineSyntaxResult(options.snapshot, options.fullText)

  return {
    foldingSupport: 'supported',
    refresh: async (snapshot, fullText) => {
      const text = fullText ?? options.fullText
      recordingText(recording, text)
      result = createLineSyntaxResult(snapshot, text)
      return result
    },
    applyChange: async (change) => {
      result = createLineSyntaxResult(change.snapshot, change.textSnapshot.materializeFullText())
      return result
    },
    dispose: () => undefined,
    getResult: () => result,
    getSnapshotVersion: () => 0,
    getTokens: () => result.tokens,
  }
}

function recordingText(recording: RecordingSyntaxState, text: string): void {
  if (text.length === 0) return

  recording.parsedTexts.push(text)
}

function tokenSyntaxProvider(tokens: readonly EditorToken[]): EditorSyntaxProvider {
  return {
    createSession: (options) => tokenSyntaxSession(options, tokens),
  }
}

function tokenSyntaxSession(
  options: EditorSyntaxSessionOptions,
  tokens: readonly EditorToken[],
): EditorSyntaxSession {
  let result = createTokenSyntaxResult(options.snapshot, tokens)

  return {
    foldingSupport: 'supported',
    refresh: async (snapshot) => {
      result = createTokenSyntaxResult(snapshot, tokens)
      return result
    },
    applyChange: async (change) => {
      result = createTokenSyntaxResult(change.snapshot, tokens)
      return result
    },
    dispose: () => undefined,
    getResult: () => result,
    getSnapshotVersion: () => 0,
    getTokens: () => result.tokens,
  }
}

function createLineSyntaxResult(snapshot: PieceTableSnapshot, text: string): EditorSyntaxResult {
  return {
    ...createEmptySyntaxResult({
      snapshot: {
        length: snapshot.length,
      },
    }),
    tokens: text.length > 0 ? [syntaxToken(0, Math.min(5, text.length))] : [],
  }
}

function createTokenSyntaxResult(
  snapshot: PieceTableSnapshot,
  tokens: readonly EditorToken[],
): EditorSyntaxResult {
  return {
    ...createEmptySyntaxResult({
      snapshot: {
        length: snapshot.length,
      },
    }),
    tokens,
  }
}

function syntaxToken(start: number, end: number): EditorToken {
  return {
    end,
    start,
    style: { color: 'var(--editor-syntax-keyword)' },
  }
}
