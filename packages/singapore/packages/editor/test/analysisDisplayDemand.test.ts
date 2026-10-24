import { createEditorStructuralOperation } from '../src/editor/operationDefinitions'
import { describe, expect, it, vi } from 'vitest'
import {
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
} from '../src/documentSession'
import { createEditorDocumentAnalysis } from '../src/editor/documentAnalysis'
import type { Editor } from '../src/editor'
import type { EditorPlugin } from '../src/plugins'
import {
  createEmptySyntaxResult,
  createEmptySyntaxSession,
  type EditorSyntaxProvider,
  type EditorSyntaxRuntime,
  type FoldRange,
  type EditorSyntaxRange,
} from '../src/syntax/session'
import { VirtualizedTextView } from '../src/virtualization'
import { createVisibleEditor } from './factories/visibleEditor'

function textView(editor: Editor): VirtualizedTextView {
  const view: unknown = Reflect.get(editor, 'view')
  if (!(view instanceof VirtualizedTextView))
    throw new TypeError('Expected the real Editor text view')
  return view
}

function mountedRange(editor: Editor): EditorSyntaxRange {
  const rows = textView(editor).getState().mountedRows
  return { startIndex: rows[0]!.startOffset, endIndex: rows.at(-1)!.endOffset }
}

describe('analysis display demand', () => {
  it.each(['tokens', 'nested-layout'] as const)(
    'keeps reentrant %s demand unknown until atomic rows commit',
    (reentry) => {
      const oldText = Array.from({ length: 6 }, (_, index) => `old${index}\n`).join('')
      const nextText = Array.from({ length: 8 }, (_, index) => `new${index}\n`).join('')
      const buffer = createEditorTextBuffer(oldText)
      const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'reentrant.ts' })
      const result = createEmptySyntaxResult()
      const provider: EditorSyntaxProvider = {
        operation: createEditorStructuralOperation(() => ({
          analyze: async () => createEmptySyntaxResult(),
          ...createEmptySyntaxSession(),
          foldingSupport: 'supported',
          queryRange: async () => result,
        })),
      }
      const host = document.createElement('div')
      document.body.appendChild(host)
      let currentView: VirtualizedTextView | null = null
      const viewportUpdates: {
        atomic: boolean
        height: number
        width: number
        text: string
        rows: readonly (string | null)[]
      }[] = []
      const plugin: EditorPlugin = {
        activate: (context) => [
          context.registerSyntaxProvider(provider),
          context.registerViewContribution({
            createContribution: () => ({
              inputs: ['viewport'],
              update: (snapshot) => {
                if (!currentView) return
                viewportUpdates.push({
                  atomic: currentView.isRenderingAtomically,
                  height: snapshot.viewport.clientHeight,
                  width: snapshot.viewport.clientWidth,
                  text: snapshot.textSnapshot.readRange(0, snapshot.textSnapshot.length),
                  rows: currentView.getState().mountedRows.map((row) => row.element.textContent),
                })
              },
              dispose: () => undefined,
            }),
          }),
        ],
      }
      const editor = createVisibleEditor(host, { plugins: [plugin] })
      const view = textView(editor)
      currentView = view
      view.setScrollMetrics(0, 72, 400)
      editor.attachSession(createEditorBufferSession(buffer), {
        analysis,
        documentId: 'reentrant.ts',
        languageId: 'typescript',
      })
      const inspect = () => analysis.inspectRetention().entries[0]!.displayDemand
      expect(inspect()).toMatchObject({
        frames: 1,
        unknownLeases: 0,
        ranges: [{ startIndex: 0, endIndex: oldText.length }],
      })
      expect(view.getState().mountedRows[0]!.element.textContent).toBe('old0')
      viewportUpdates.length = 0
      view.setScrollMetrics(0, 96, 320)
      expect(viewportUpdates).toHaveLength(1)
      expect(viewportUpdates[0]).toMatchObject({ atomic: false, height: 96, width: 320 })
      view.setScrollMetrics(0, 72, 400)
      viewportUpdates.length = 0
      const observations: { atomic: boolean; oldDOM: boolean; frames: number; unknown: number }[] =
        []
      let entered = false
      const subscription = editor.onDidChangeContentHeight(() => {
        if (entered) return
        entered = true
        expect(buffer.getTextSnapshot().materializeFullText()).toBe(nextText)
        const oldDOM = view
          .getState()
          .mountedRows.some((row) => row.element.textContent?.startsWith('old'))
        editor.setSelection(0)
        if (reentry === 'nested-layout') {
          view.runAtomicRender(() => view.setScrollMetrics(0, 96, 320))
        }
        editor.setTokens([])
        expect(viewportUpdates).toHaveLength(0)
        observations.push({
          atomic: view.isRenderingAtomically,
          oldDOM,
          frames: inspect().frames,
          unknown: inspect().unknownLeases,
        })
      })
      try {
        editor.setContent(nextText)
        expect(view.isRenderingAtomically).toBe(false)
        expect(view.getState().mountedRows.map((row) => row.element.textContent)).toEqual(
          Array.from({ length: 8 }, (_, index) => `new${index}`).concat(['']),
        )
        expect(inspect()).toMatchObject({
          frames: 1,
          unknownLeases: 0,
          ranges: [{ startIndex: 0, endIndex: nextText.length }],
        })
        if (reentry === 'nested-layout')
          expect(view.getState()).toMatchObject({ viewportHeight: 96, viewportWidth: 320 })
        expect(observations).toEqual([{ atomic: true, oldDOM: true, frames: 0, unknown: 1 }])
        expect(viewportUpdates).toEqual([
          {
            atomic: false,
            height: reentry === 'nested-layout' ? 96 : 72,
            width: reentry === 'nested-layout' ? 320 : 400,
            text: nextText,
            rows: Array.from({ length: 8 }, (_, index) => `new${index}`).concat(['']),
          },
        ])
      } finally {
        subscription.dispose()
        editor.dispose()
        analysis.dispose()
        host.remove()
      }
    },
  )

  it('publishes both cached view frames before notifications and tracks layout, folds, edits and clear', async () => {
    const buffer = createEditorTextBuffer(
      Array.from({ length: 500 }, (_, index) => `line${index} ${'x'.repeat(90)}\n`).join(''),
    )
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: 'frames.ts' })
    const fold: FoldRange = {
      startLine: 0,
      endLine: 5,
      startIndex: 0,
      endIndex: buffer.getTextSnapshot().lineRange(5).end,
      type: 'block',
    }
    const result = { ...createEmptySyntaxResult(), folds: [fold] }
    const queryRange = vi.fn(async () => result)
    const providerOpenRuntime = vi.fn((): EditorSyntaxRuntime => ({
      foldingSupport: 'supported',
      analyze: async () => result,

      queryRange,
      getResult: () => result,
      getTokens: () => result.tokens,
      getSnapshotVersion: () => 0,
      dispose: () => undefined,
    }))
    const provider: EditorSyntaxProvider = {
      operation: createEditorStructuralOperation(providerOpenRuntime),
    }
    const warm = analysis.borrowStructural({
      provider,
      languageId: 'typescript',
      includeCaptures: false,
      includeHighlights: true,
      syntaxMode: 'range',
    })!
    await warm.queryRange({ startIndex: 0, endIndex: buffer.getTextSnapshot().length })
    warm.dispose()
    const plugin: EditorPlugin = { activate: (context) => context.registerSyntaxProvider(provider) }
    const hosts = [document.createElement('div'), document.createElement('div')]
    hosts.forEach((host) => document.body.appendChild(host))
    const editors: Editor[] = []
    let observed = 0
    const assertFrames = () => {
      const demand = analysis.inspectRetention().entries[0]!.displayDemand
      expect(demand).toMatchObject({ unmanagedLeases: 0, unknownLeases: 0, frames: editors.length })
      expect(demand.ranges).toEqual(editors.map(mountedRange))
    }
    try {
      for (let index = 0; index < 2; index++) {
        const editor = createVisibleEditor(hosts[index]!, {
          plugins: [plugin],
          onChange: () => {
            if (!editors[index]) return
            if (analysis.inspectRetention().entries[0]!.leaseCount !== editors.length) return
            const demand = analysis.inspectRetention().entries[0]!.displayDemand
            expect(demand.frames + demand.unknownLeases).toBe(editors.length)
            if (textView(editors[index]!).isRenderingAtomically) {
              expect(demand.unknownLeases).toBeGreaterThan(0)
              return
            }
            expect(demand.ranges).toContainEqual(mountedRange(editors[index]!))
            observed++
          },
        })
        editors.push(editor)
        editor.attachSession(
          createEditorBufferSession(buffer, createEditorViewSession(buffer, `view${index}`)),
          { analysis, documentId: 'frames.ts', languageId: 'typescript' },
        )
        textView(editor).setScrollMetrics(index * 2400, 72, 400)
      }
      assertFrames()
      expect(observed).toBeGreaterThan(0)
      expect(analysis.inspectRetention().entries[0]!.displayDemand.ranges[0]).not.toEqual(
        analysis.inspectRetention().entries[0]!.displayDemand.ranges[1],
      )
      editors[0]!.setWordWrap(true)
      textView(editors[0]!).setScrollMetrics(240, 96, 180)
      editors[0]!.setFontSize(18)
      assertFrames()
      editors[0]!.setSyntaxFolds([fold])
      textView(editors[0]!).setScrollMetrics(0, 96, 400)
      const unfoldedRange = mountedRange(editors[0]!)
      expect(editors[0]!.fold(0)).toBe(true)
      expect(
        textView(editors[0]!)
          .getState()
          .foldMarkers.filter((marker) => marker.collapsed)
          .map((marker) => marker.startRow),
      ).toEqual([0])
      expect(mountedRange(editors[0]!)).not.toEqual(unfoldedRange)
      assertFrames()
      expect(editors[0]!.unfold(0)).toBe(true)
      expect(
        textView(editors[0]!)
          .getState()
          .foldMarkers.filter((marker) => marker.collapsed),
      ).toEqual([])
      textView(editors[0]!).setScrollMetrics(0, 72, 400)
      assertFrames()
      await vi.waitFor(() => expect(queryRange).toHaveBeenCalledTimes(1))
      editors[0]!.edit({ from: 0, to: 0, text: '!' })
      assertFrames()
      editors[0]!.setContent('')
      assertFrames()
      editors[0]!.dispose()
      editors.shift()
      assertFrames()
      expect(providerOpenRuntime).toHaveBeenCalledTimes(1)
    } finally {
      editors.forEach((editor) => editor.dispose())
      hosts.forEach((host) => host.remove())
      analysis.dispose()
    }
  })
})
