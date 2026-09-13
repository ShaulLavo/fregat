import type {
  EditorPlugin,
  EditorPluginContext,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { LanguageServerDiagnosticMarkerEvent } from '@singapore-editor/lsp-plugin'
import { describe } from 'vitest'

import { createDiagnosticPeekSource } from '@/features/editor/state/diagnostic-peek-source'
import { expect, test } from '../../../../../test/fixtures'

describe('diagnostic peek source', () => {
  test('claims, normalizes, follows edits, and closes when the range is deleted', () => {
    const source = createDiagnosticPeekSource('file:///repo/a.ts')
    const harness = attachSource(source.plugin)

    const claim = source.claim(markerEvent())
    expect(claim.kind).toBe('claimed')
    expect(source.getSnapshot()).toMatchObject({
      code: 'TS100',
      message: 'Unknown name',
      severity: 'Error',
      source: 'typescript',
      geometry: { kind: 'hidden', range: { start: 6, end: 11 } },
      relatedInformation: [
        {
          column: 3,
          label: 'Declared here',
          line: 3,
          target: { path: 'repo/b.ts', uri: 'file:///repo/b.ts' },
        },
      ],
    })

    harness.setRange({ start: 9, end: 14 })
    expect(source.getSnapshot()?.geometry).toMatchObject({
      kind: 'hidden',
      range: { start: 9, end: 14 },
    })

    harness.setRange(null)
    expect(source.getSnapshot()).toBeNull()
    if (claim.kind !== 'claimed') throw new TypeError('Expected a claimed diagnostic')
    claim.dispose()
    expect(source.getSnapshot()).toBeNull()
  })

  test('ignores stale versions and producer cleanup cannot close a replacement', () => {
    const source = createDiagnosticPeekSource('file:///repo/a.ts')
    attachSource(source.plugin)

    expect(source.claim({ ...markerEvent(), textVersion: 99 })).toEqual({ kind: 'ignored' })
    const first = source.claim(markerEvent())
    const second = source.claim({ ...markerEvent(), direction: 'previous' })
    if (first.kind !== 'claimed' || second.kind !== 'claimed') {
      throw new TypeError('Expected claimed diagnostics')
    }
    first.dispose()
    expect(source.getSnapshot()?.direction).toBe('previous')
    second.dispose()
    expect(source.getSnapshot()).toBeNull()
  })

  test('retains hidden state, resurfaces, and closes on terminal view lifecycle', () => {
    const source = createDiagnosticPeekSource('file:///repo/a.ts')
    const harness = attachSource(source.plugin)

    expect(source.claim(markerEvent()).kind).toBe('claimed')
    harness.setRect(visibleRect())
    expect(source.getSnapshot()?.geometry).toMatchObject({ kind: 'visible' })
    const visible = source.getSnapshot()?.geometry
    expect(visible?.kind === 'visible' && Object.isFrozen(visible.anchorRect)).toBe(true)

    harness.setRect(null)
    expect(source.getSnapshot()?.geometry).toMatchObject({ kind: 'hidden' })
    harness.setRect(visibleRect())
    expect(source.getSnapshot()?.geometry).toMatchObject({ kind: 'visible' })

    harness.replaceDocument('document-b')
    expect(source.getSnapshot()).toBeNull()
    expect(source.claim(markerEvent()).kind).toBe('claimed')
    harness.dispose()
    expect(source.getSnapshot()).toBeNull()
  })
})

function attachSource(plugin: EditorPlugin) {
  let clientRect: DOMRect | null = null
  let snapshot = viewSnapshot()
  let provider: EditorViewContributionProvider | null = null
  let range: { readonly start: number; readonly end: number } | null = {
    start: 6,
    end: 11,
  }
  const pluginContext = {
    registerViewContribution: (next: EditorViewContributionProvider) => {
      provider = next
      return { dispose: () => undefined }
    },
  } as EditorPluginContext
  plugin.activate(pluginContext)
  const context = {
    getSnapshot: () => snapshot,
    getRangeClientRect: () => clientRect,
    scrollElement: { getBoundingClientRect: () => emptyRect() },
    trackRanges: () => ({ resolve: () => (range ? [range] : []) }),
  } as unknown as EditorViewContributionContext
  const contribution: EditorViewContribution = provider!.createContribution(context)!

  return {
    dispose: () => contribution.dispose(),
    replaceDocument: (documentId: string) => {
      snapshot = viewSnapshot(documentId)
      contribution.update(snapshot, 'document')
    },
    setRange: (next: typeof range) => {
      range = next
      contribution.update(snapshot, 'content')
    },
    setRect: (next: DOMRect | null) => {
      clientRect = next
      contribution.update(snapshot, 'viewport')
    },
  }
}

function viewSnapshot(documentId = 'document-a') {
  return { documentId, textVersion: 0 } as EditorViewSnapshot
}

function emptyRect() {
  return { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 } as DOMRect
}

function visibleRect() {
  return { bottom: 40, height: 20, left: 20, right: 60, top: 20, width: 40 } as DOMRect
}

function markerEvent(): LanguageServerDiagnosticMarkerEvent {
  return {
    anchor: { kind: 'range', start: 6, end: 11, startBias: 'right', endBias: 'left' },
    diagnostic: {
      code: 'TS100',
      message: 'Unknown name',
      severity: 1,
      source: 'typescript',
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
      relatedInformation: [
        {
          location: {
            uri: 'file:///repo/b.ts',
            range: { start: { line: 2, character: 2 }, end: { line: 2, character: 5 } },
          },
          message: 'Declared here',
        },
      ],
    },
    direction: 'next',
    documentUri: 'file:///repo/a.ts',
    textVersion: 0,
  }
}
