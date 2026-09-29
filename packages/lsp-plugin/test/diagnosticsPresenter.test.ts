import type {
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { describe, expect, it, vi } from 'vitest'
import { createTestViewContributionContext } from '@singapore-editor/core/testing'
import type * as lsp from 'vscode-languageserver-protocol'

import { DiagnosticsPresenter } from '../src/diagnosticsPresenter'
import { DIAGNOSTIC_MARKER_COLORS } from '../src/plugin.styles'
import { snapshotDocument } from './snapshotDocument'

describe('DiagnosticsPresenter', () => {
  it('paints both tags through overlays and reads the registered theme alpha', () => {
    const context = editorContext(new TestMinimap())
    const presenter = new DiagnosticsPresenter(context, 'tag-test', {
      minimapSourceId: 'test',
      highlightNameNamespace: 'lsp',
      markerTimingNamePrefix: 'test',
    })
    const getStyle = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ color: 'rgba(0, 0, 0, 0.25)' } as CSSStyleDeclaration)
    try {
      presenter.render(activeDocument('abc'), [
        { ...diagnostic(4, 0, 3, 'unused old'), tags: [1, 2] },
      ])
      expect(context.setRangeHighlight).toHaveBeenCalledWith(
        'tag-test-lsp-unnecessary',
        [{ start: 0, end: 3 }],
        { overlay: { dim: 0.25 } },
      )
      expect(context.setRangeHighlight).toHaveBeenCalledWith(
        'tag-test-lsp-deprecated',
        [{ start: 0, end: 3 }],
        { overlay: { textDecoration: 'line-through' } },
      )
      expect(context.setRangeHighlight).toHaveBeenCalledWith(
        'tag-test-lsp-hint',
        [],
        expect.anything(),
      )
      presenter.clear()
      expect(context.clearRangeHighlight).toHaveBeenCalledWith('tag-test-lsp-unnecessary')
    } finally {
      getStyle.mockRestore()
    }
  })

  it('reads the unnecessary alpha once per theme', () => {
    const context = editorContext(new TestMinimap())
    const presenter = new DiagnosticsPresenter(context, 'tag-test', {
      minimapSourceId: 'test',
      highlightNameNamespace: 'lsp',
      markerTimingNamePrefix: 'test',
    })
    const getStyle = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ color: 'rgba(0, 0, 0, 0.25)' } as CSSStyleDeclaration)
    try {
      const unused: lsp.Diagnostic[] = [{ ...diagnostic(4, 0, 3, 'unused'), tags: [1] }]
      presenter.render(activeDocument('abc'), unused)
      presenter.render(activeDocument('abc'), unused)
      expect(getStyle).toHaveBeenCalledTimes(1)
      presenter.invalidateTheme()
      presenter.render(activeDocument('abc'), unused)
      expect(getStyle).toHaveBeenCalledTimes(2)
    } finally {
      getStyle.mockRestore()
    }
  })

  it('uses configured highlight names, minimap source, and marker timing names', () => {
    const minimap = new TestMinimap()
    const context = editorContext(minimap)
    const presenter = new DiagnosticsPresenter(context, 'editor-test', {
      minimapSourceId: 'editor.test.diagnostics',
      highlightNameNamespace: 'test-lsp',
      markerTimingNamePrefix: 'testLsp.marker',
    })
    const diagnosticItem = diagnostic(1, 1, 2)

    presenter.render(snapshotDocument('abc'), [diagnosticItem])
    presenter.moveMarker(activeDocument('abc'), [diagnosticItem], 'next')
    presenter.clear()

    expect(context.setRangeHighlight).toHaveBeenCalledWith(
      'editor-test-test-lsp-error',
      [{ start: 1, end: 2 }],
      expect.any(Object),
    )
    expect(minimap.setDecorations).toHaveBeenCalledWith('editor.test.diagnostics', [
      expect.objectContaining({ startLineNumber: 1, color: DIAGNOSTIC_MARKER_COLORS.error }),
    ])
    expect(context.setSelection).toHaveBeenCalledWith(1, 2, 'testLsp.marker.next', {
      revealOffset: 1,
    })
    expect(minimap.clearDecorations).toHaveBeenCalledWith('editor.test.diagnostics')
  })

  it('publishes the selected diagnostic after navigation and revokes claims', () => {
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const onDidNavigateDiagnostic = vi
      .fn()
      .mockReturnValueOnce({ kind: 'claimed', dispose: firstDispose })
      .mockReturnValueOnce({ kind: 'claimed', dispose: secondDispose })
    const context = editorContext(new TestMinimap())
    const presenter = new DiagnosticsPresenter(context, 'editor-test', {
      minimapSourceId: 'editor.test.diagnostics',
      highlightNameNamespace: 'test-lsp',
      markerTimingNamePrefix: 'testLsp.marker',
      onDidNavigateDiagnostic,
    })
    const earlier = diagnostic(1, 0, 0, 'point')
    const later = diagnostic(2, 2, 3, 'later')

    expect(presenter.moveMarker(activeDocument('abc'), [earlier, later], 'next')).toBe(true)
    expect(onDidNavigateDiagnostic).toHaveBeenLastCalledWith({
      anchor: { kind: 'range', start: 2, end: 3, startBias: 'right', endBias: 'left' },
      diagnostic: later,
      direction: 'next',
      documentUri: 'file:///src/index.ts',
      textVersion: 7,
    })
    expect(context.focusEditor).toHaveBeenCalledBefore(onDidNavigateDiagnostic)

    expect(presenter.moveMarker(activeDocument('abc'), [earlier, later], 'next')).toBe(true)
    expect(firstDispose).toHaveBeenCalledOnce()
    presenter.clear()
    expect(secondDispose).toHaveBeenCalledOnce()
  })

  it('publishes a point anchor and reports callback errors without undoing navigation', () => {
    const callbackError = new TypeError('consumer failed')
    const onError = vi.fn()
    const presenter = new DiagnosticsPresenter(editorContext(new TestMinimap()), 'editor-test', {
      minimapSourceId: 'editor.test.diagnostics',
      highlightNameNamespace: 'test-lsp',
      markerTimingNamePrefix: 'testLsp.marker',
      onDidNavigateDiagnostic: (event) => {
        expect(event.anchor).toEqual({ kind: 'point', offset: 1, bias: 'right' })
        throw callbackError
      },
      onError,
    })

    expect(
      presenter.moveMarker(activeDocument('abc'), [diagnostic(1, 1, 1, 'point')], 'next'),
    ).toBe(true)
    expect(onError).toHaveBeenCalledWith(callbackError)
  })

  it('wraps marker navigation and publishes the diagnostic that was selected', () => {
    const first = diagnostic(1, 1, 2, 'first')
    const last = diagnostic(2, 3, 4, 'last')
    const next = vi.fn(() => ({ kind: 'ignored' as const }))
    const previous = vi.fn(() => ({ kind: 'ignored' as const }))
    const nextPresenter = new DiagnosticsPresenter(
      editorContext(new TestMinimap(), 3),
      'editor-test',
      presenterOptions(next),
    )
    const previousPresenter = new DiagnosticsPresenter(
      editorContext(new TestMinimap(), 1),
      'editor-test',
      presenterOptions(previous),
    )

    expect(nextPresenter.moveMarker(activeDocument('abcde'), [first, last], 'next')).toBe(true)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ diagnostic: first }))
    expect(previousPresenter.moveMarker(activeDocument('abcde'), [first, last], 'previous')).toBe(
      true,
    )
    expect(previous).toHaveBeenCalledWith(expect.objectContaining({ diagnostic: last }))
  })

  it('publishes summarized diagnostics through the configured callback', () => {
    const onDiagnostics = vi.fn()
    const presenter = new DiagnosticsPresenter(editorContext(new TestMinimap()), 'editor-test', {
      minimapSourceId: 'editor.test.diagnostics',
      highlightNameNamespace: 'test-lsp',
      markerTimingNamePrefix: 'testLsp.marker',
      onDiagnostics,
    })

    presenter.publishSummary('file:///src/index.ts', 2, [diagnostic(2, 0, 0)])

    expect(onDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'file:///src/index.ts',
        version: 2,
        counts: expect.objectContaining({ warning: 1, total: 1 }),
      }),
    )
  })
})

class TestMinimap {
  public readonly setDecorations = vi.fn()
  public readonly clearDecorations = vi.fn()
}

function editorContext(minimap: TestMinimap, headOffset = 0): EditorViewContributionContext {
  return createTestViewContributionContext({
    getSnapshot: () =>
      ({ lineCount: 1, selections: [{ headOffset }] }) as unknown as EditorViewSnapshot,
    getFeature: (() => minimap) as EditorViewContributionContext['getFeature'],
    setRangeHighlight: vi.fn(),
    clearRangeHighlight: vi.fn(),
    setSelection: vi.fn(),
    focusEditor: vi.fn(),
  })
}

function presenterOptions(
  onDidNavigateDiagnostic: NonNullable<
    ConstructorParameters<typeof DiagnosticsPresenter>[2]['onDidNavigateDiagnostic']
  >,
) {
  return {
    minimapSourceId: 'editor.test.diagnostics',
    highlightNameNamespace: 'test-lsp',
    markerTimingNamePrefix: 'testLsp.marker',
    onDidNavigateDiagnostic,
  }
}

function activeDocument(text: string) {
  return { ...snapshotDocument(text), textVersion: 7, uri: 'file:///src/index.ts' }
}

function diagnostic(
  severity: lsp.DiagnosticSeverity,
  start: number,
  end: number,
  message = 'message',
): lsp.Diagnostic {
  return {
    severity,
    message,
    range: {
      start: { line: 0, character: start },
      end: { line: 0, character: end },
    },
  }
}
