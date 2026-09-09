import {
  createDocumentTextSnapshot,
  createEmptySyntaxResult,
  createPieceTableSnapshot,
  type EditorSyntaxProvider,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
  type EditorSyntaxSessionOptions,
  type EditorToken,
  type PieceTableSnapshot,
} from '@singapor/core'
import { describe, expect, it } from 'vitest'

import { createSearchResultSyntaxProvider } from '@/features/search/utils/result-syntax-plugin'

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
})

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
