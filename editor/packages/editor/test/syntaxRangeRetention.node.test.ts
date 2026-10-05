import { describe, expect, it, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  type EditorTextBuffer,
} from '../src/documentSession'
import {
  createEditorDocumentAnalysis,
  type EditorDocumentAnalysis,
} from '../src/editor/documentAnalysis'
import { DocumentEditChain } from '../src/editor/editChain'
import { EditorSyntaxController } from '../src/editor/syntaxController'
import { EditorPluginHost } from '../src/plugins'
import {
  createEmptySyntaxResult,
  createEmptySyntaxSession,
  type EditorSyntaxProvider,
  type EditorSyntaxRange,
  type EditorSyntaxResult,
} from '../src/syntax/session'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import type { EditorHighlighterProvider } from '../src/syntax/highlighter'

describe('syntax range contributor lifetime', () => {
  it.each(['disjoint', 'overlap'] as const)(
    'bounds forty %s publications through the public controller lifecycle',
    async (mode) => {
      const buffer = createEditorTextBuffer('x\n'.repeat(50_000))
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: mode })
      const ranges = vi.fn(async (range: EditorSyntaxRange) => {
        const startIndex = mode === 'overlap' && range.startIndex > 1000 ? 50_000 : range.startIndex
        const endIndex = mode === 'overlap' && range.startIndex > 1000 ? 51_024 : range.endIndex
        return {
          ...createEmptySyntaxResult({ requestedRanges: [range] }),
          records: { languageId: 'typescript', data: new Uint32Array(256) },
          tokens: EditorTokenStore.fromTokens(
            Array.from({ length: 128 }, (_, index) => ({
              start: range.startIndex + index * 2,
              end: range.startIndex + index * 2 + 1,
              style: { color: 'fixture' },
            })),
          ),
          folds: [
            {
              startIndex,
              endIndex,
              startLine: Math.floor(startIndex / 2),
              endLine: Math.floor(endIndex / 2) - 1,
              type: 'scope',
            },
          ],
        }
      })
      const create = vi.fn(() => ({
        ...createEmptySyntaxSession(),
        foldingSupport: 'supported' as const,
        queryRange: ranges,
      }))
      const provider = { createSession: create } satisfies EditorSyntaxProvider
      const left = createView(buffer, analysis, provider, { startIndex: 0, endIndex: 512 })
      const right = createView(buffer, analysis, provider, { startIndex: 1024, endIndex: 1536 })
      try {
        left.syntax.refresh(1, null, { delayMs: 0 })
        await vi.waitFor(() => expect(left.syntax.tokens.length).toBe(128))
        for (let step = 0; step < 40; step++) {
          const range =
            mode === 'overlap'
              ? { startIndex: 50_000 - step, endIndex: 51_024 + step }
              : { startIndex: (step + 1) * 1024, endIndex: (step + 1) * 1024 + 512 }
          right.setRange(range)
          right.syntax.refresh(1, null, { delayMs: 0 })
          await vi.waitFor(() => expect(ranges).toHaveBeenCalledTimes(step + 2))
          await vi.waitFor(() => expect(right.syntax.tokens.length).toBe(128))
          expect(analysis.inspectRetention().entries[0]!.cachedRangeCount).toBeLessThanOrEqual(2)
          expect(
            EditorTokenStore.inspectRetention([right.syntax.tokens, right.syntax.copyTokens])
              .backingBytes,
          ).toBeLessThanOrEqual(4096)
          expect(right.folds()).toBe(1)
        }
        expect(create).toHaveBeenCalledTimes(1)
        const before = right.adoptions()
        right.publish()
        right.publish()
        expect(right.adoptions()).toBe(before)
      } finally {
        left.dispose()
        right.dispose()
        analysis.dispose()
      }
    },
  )

  it('keeps explicitly installed tokens and their accepted copy authority', () => {
    const buffer = createEditorTextBuffer('x\n'.repeat(100))
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'manual' })
    const provider = { createSession: () => createEmptySyntaxSession() }
    const view = createView(buffer, analysis, provider, { startIndex: 0, endIndex: 20 })
    try {
      const tokens = EditorTokenStore.fromTokens([
        { start: 100, end: 110, style: { color: 'manual' } },
      ])
      view.syntax.setTokens(tokens)
      view.publish()
      expect(view.syntax.tokens).toBe(tokens)
      expect(view.syntax.copyTokens).toBe(tokens)
      expect(
        EditorTokenStore.inspectRetention([view.syntax.tokens, view.syntax.copyTokens])
          .backingBytes,
      ).toBe(12)
    } finally {
      view.dispose()
      analysis.dispose()
    }
  })

  it('keeps full highlighter state and its authoritative copy store', async () => {
    const buffer = createEditorTextBuffer('x\n'.repeat(100))
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'full-highlighter' })
    const tokens = EditorTokenStore.fromTokens([{ start: 100, end: 110, style: { color: 'full' } }])
    const refresh = async () => ({ tokens })
    const highlighter = {
      createSession: () => ({ refresh, applyChange: refresh, dispose: () => undefined }),
    }
    const ranges = vi.fn(async (range: EditorSyntaxRange) =>
      createEmptySyntaxResult({ requestedRanges: [range] }),
    )
    const provider = {
      createSession: () => ({ ...createEmptySyntaxSession(), queryRange: ranges }),
    }
    const view = createView(
      buffer,
      analysis,
      provider,
      { startIndex: 0, endIndex: 20 },
      highlighter,
    )
    try {
      view.syntax.refresh(1, null, { delayMs: 0 })
      await vi.waitFor(() => expect(view.syntax.tokens).toBe(tokens))
      view.publish()
      expect(view.syntax.tokens).toBe(tokens)
      expect(view.syntax.copyTokens).toBe(tokens)
      for (let step = 0; step < 40; step++) {
        view.setRange({ startIndex: 0, endIndex: 21 + step })
        view.syntax.refresh(1, null, { delayMs: 0 })
        await vi.waitFor(() => expect(ranges).toHaveBeenCalledTimes(step + 2))
        expect(view.syntax.tokens).toBe(tokens)
        expect(view.syntax.copyTokens).toBe(tokens)
        expect(
          analysis.inspectRetention().entries.find((entry) => entry.family === 'structural')!
            .cachedRangeCount,
        ).toBeLessThanOrEqual(1)
      }
      expect(
        analysis.inspectRetention().entries.find((entry) => entry.family === 'highlighter')!
          .leaseCount,
      ).toBe(1)
      expect(
        EditorTokenStore.inspectRetention([view.syntax.tokens, view.syntax.copyTokens])
          .backingBytes,
      ).toBe(12)
    } finally {
      view.dispose()
      analysis.dispose()
    }
  })

  it('preserves manual tokens carried through a partial structural update and scroll', async () => {
    const buffer = createEditorTextBuffer('x\n'.repeat(100))
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'mixed-origin' })
    const provider = {
      createSession: () => ({
        ...createEmptySyntaxSession(),
        queryRange: async (range: EditorSyntaxRange) =>
          createEmptySyntaxResult({ requestedRanges: [range] }),
      }),
    }
    const view = createView(buffer, analysis, provider, { startIndex: 0, endIndex: 20 })
    try {
      view.syntax.setTokens(
        EditorTokenStore.fromTokens([{ start: 100, end: 110, style: { color: 'manual' } }]),
      )
      view.syntax.refresh(1, null, { delayMs: 0 })
      await vi.waitFor(() => expect(view.syntax.copyTokens.length).toBe(0))
      view.setRange({ startIndex: 20, endIndex: 40 })
      expect(view.syntax.tokens.toTokens()).toEqual([
        { start: 100, end: 110, style: { color: 'manual' } },
      ])
    } finally {
      view.dispose()
      analysis.dispose()
    }
  })

  it('keeps an actual crossing fold contributor when its query lies outside the new frame', async () => {
    const buffer = createEditorTextBuffer('x\n'.repeat(250))
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'crossing' })
    const provider = {
      createSession: () => ({
        ...createEmptySyntaxSession(),
        foldingSupport: 'supported' as const,
        queryRange: async (range: EditorSyntaxRange) => ({
          ...createEmptySyntaxResult({ requestedRanges: [range] }),
          records: { languageId: 'typescript', data: new Uint32Array(256) },
          tokens: EditorTokenStore.fromTokens([{ start: 0, end: 1, style: { color: 'crossing' } }]),
          folds: [{ startIndex: 0, endIndex: 300, startLine: 0, endLine: 149, type: 'scope' }],
        }),
      }),
    }
    const view = createView(buffer, analysis, provider, { startIndex: 0, endIndex: 100 })
    try {
      view.syntax.refresh(1, null, { delayMs: 0 })
      await vi.waitFor(() => expect(view.folds()).toBe(1))
      view.setRange({ startIndex: 200, endIndex: 250 })
      expect(view.folds()).toBe(1)
      expect(view.syntax.tokens.toTokens()).toEqual([
        { start: 0, end: 1, style: { color: 'crossing' } },
      ])
      expect(view.syntax.copyTokens.toTokens()).toEqual(view.syntax.tokens.toTokens())
      expect(analysis.inspectRetention().entries[0]).toMatchObject({
        cachedRangeCount: 1,
        syntaxRecordBackingBytes: 1024,
      })
    } finally {
      view.dispose()
      analysis.dispose()
    }
  })

  it('ends optional warming after pruning and blocks repeated warming of the same source', async () => {
    const buffer = createEditorTextBuffer('x\n'.repeat(250_000))
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'warm-stop' })
    let resolveSecondWarm!: (result: EditorSyntaxResult) => void
    const secondWarm = new Promise<EditorSyntaxResult>((resolve) => {
      resolveSecondWarm = resolve
    })
    const ranges = vi.fn((range: EditorSyntaxRange) => {
      if (range.startIndex === 240_000) return secondWarm
      return Promise.resolve({
        ...createEmptySyntaxResult({ requestedRanges: [range] }),
        tokens: EditorTokenStore.fromTokens([
          { start: range.startIndex, end: range.startIndex + 1, style: { color: 'warm' } },
        ]),
      })
    })
    const provider = {
      createSession: () => ({ ...createEmptySyntaxSession(), queryRange: ranges }),
    }
    const frame = { startIndex: 0, endIndex: 512 }
    const view = createView(buffer, analysis, provider, frame)
    try {
      view.syntax.refresh(1, null, { delayMs: 0 })
      await vi.waitFor(() => expect(view.syntax.copyTokens.startAt(0)).toBe(120_000))
      await vi.waitFor(() => expect(ranges).toHaveBeenCalledTimes(3))
      expect(Reflect.get(view.syntax, 'stoppedWarm')).toBeNull()
      expect(view.syntax.tokens.toTokens().map((token) => token.start)).toEqual([0, 120_000])
      expect(analysis.inspectRetention().entries[0]!.cachedRangeCount).toBe(2)
      expect(view.syntax.renderDataReady).toBe(true)

      resolveSecondWarm({
        ...createEmptySyntaxResult({
          requestedRanges: [{ startIndex: 240_000, endIndex: 360_000 }],
        }),
        tokens: EditorTokenStore.fromTokens([
          { start: 240_000, end: 240_001, style: { color: 'warm' } },
        ]),
      })
      await vi.waitFor(() => expect(view.syntax.copyTokens.startAt(0)).toBe(240_000))
      expect(Reflect.get(view.syntax, 'stoppedWarm')).not.toBeNull()
      expect(view.syntax.tokens.toTokens().map((token) => token.start)).toEqual([0, 240_000])
      expect(analysis.inspectRetention().entries[0]!.cachedRangeCount).toBe(2)
      expect(view.syntax.tokens.startAt(0)).toBe(0)
      const copy = view.syntax.copyTokens
      const adoptions = view.adoptions()
      for (let step = 0; step < 40; step++)
        view.syntax.warmSyntaxAroundRange(1, frame, { delayMs: 0 })
      await new Promise((resolve) => setTimeout(resolve, 180))
      expect(ranges.mock.calls.map(([range]) => range)).toEqual([
        frame,
        { startIndex: 120_000, endIndex: 240_000 },
        { startIndex: 240_000, endIndex: 360_000 },
      ])
      expect(view.syntax.copyTokens).toBe(copy)
      expect(view.adoptions()).toBe(adoptions)
    } finally {
      view.dispose()
      analysis.dispose()
    }
  })

  it.each(['clear', 'replace', 'dispose', 'configuration', 'text-change'] as const)(
    'releases the old stopped-warm snapshot on %s',
    async (boundary) => {
      const buffer = createEditorTextBuffer('x\n'.repeat(250_000))
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: boundary })
      const provider = {
        createSession: () => ({
          ...createEmptySyntaxSession(),
          queryRange: async (range: EditorSyntaxRange) => ({
            ...createEmptySyntaxResult({ requestedRanges: [range] }),
            tokens: EditorTokenStore.fromTokens([
              { start: range.startIndex, end: range.startIndex + 1, style: { color: 'warm' } },
            ]),
          }),
        }),
      }
      const view = createView(buffer, analysis, provider, { startIndex: 0, endIndex: 512 })
      try {
        view.syntax.refresh(1, null, { delayMs: 0 })
        await vi.waitFor(() => expect(view.syntax.copyTokens.startAt(0)).toBe(240_000))
        expect(Reflect.get(view.syntax, 'stoppedWarm')).not.toBeNull()
        if (boundary === 'clear') view.syntax.clearDocument()
        if (boundary === 'dispose') view.syntax.dispose()
        if (boundary === 'configuration') view.syntax.reloadSyntaxSession()
        if (boundary === 'replace') {
          const session = createEditorBufferSession(buffer)
          view.syntax.startDocument({
            analysis,
            documentId: 'replacement',
            languageId: 'typescript',
            snapshot: session.getSnapshot(),
            textSnapshot: session.getTextSnapshot(),
          })
        }
        if (boundary === 'text-change') {
          const change = createEditorBufferSession(buffer).applyText('!')
          view.syntax.acceptChange(change)
        }
        expect(Reflect.get(view.syntax, 'stoppedWarm')).toBeNull()
      } finally {
        view.dispose()
        analysis.dispose()
      }
    },
  )
})

function createView(
  buffer: EditorTextBuffer,
  analysis: EditorDocumentAnalysis,
  provider: EditorSyntaxProvider,
  initialRange: EditorSyntaxRange,
  highlighter?: EditorHighlighterProvider,
) {
  const session = createEditorBufferSession(buffer)
  const editChain = new DocumentEditChain(0, 0)
  const pluginHost = new EditorPluginHost([
    {
      activate: (context) => {
        const syntax = context.registerSyntaxProvider(provider)
        return highlighter ? [syntax, context.registerHighlighter(highlighter)] : syntax
      },
    },
  ])
  let range = initialRange
  let adoptions = 0
  let folds = 0
  const publish = () =>
    syntax.setDisplayDemand({ kind: 'frame', snapshot: buffer.getTextSnapshot(), ranges: [range] })
  const syntax = new EditorSyntaxController({
    pluginHost,
    getSession: () => session,
    getDocumentVersion: () => 1,
    getTextVersion: () => 0,
    getDocumentId: () => 'retention.ts',
    getCurrentSessionDocumentId: () => 'retention.ts',
    getLanguageId: () => 'typescript',
    getDocumentEditChain: () => editChain,
    getVisibleSyntaxRange: () => range,
    adoptTokens: () => {
      adoptions++
      publish()
    },
    setSyntaxFolds: (next) => {
      folds = next.length
    },
    clearSyntaxFolds: () => {
      folds = 0
    },
    notifyViewUpdate: publish,
    notifyChange: () => undefined,
    notifyThemeChanged: () => undefined,
  })
  syntax.startDocument({
    analysis,
    documentId: 'retention.ts',
    languageId: 'typescript',
    snapshot: session.getSnapshot(),
    textSnapshot: session.getTextSnapshot(),
  })
  publish()
  return {
    syntax,
    publish,
    setRange: (next: EditorSyntaxRange) => {
      range = next
      publish()
    },
    adoptions: () => adoptions,
    folds: () => folds,
    dispose: () => {
      syntax.dispose()
      pluginHost.dispose()
    },
  }
}
