import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import { describe, expect, it, vi } from 'vitest'
import { createStringTextSnapshot, type TextSnapshot } from '@singapore-editor/core/document'
import type { VirtualizedFoldMarker } from '@singapore-editor/core/rendering'
import type {
  EditorPluginContext,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { createScopeLinesPlugin } from '../src/index'
import {
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

const TEST_DOCUMENT_SYNC_SEGMENT = Object.freeze(
  {},
) as EditorViewSnapshot['documentSyncPoint']['segment']

describe('createScopeLinesPlugin', () => {
  it('registers a view contribution factory', () => {
    const registerViewContribution = vi.fn<EditorPluginContext['registerViewContribution']>(() => ({
      dispose: vi.fn(),
    }))
    const plugin = createScopeLinesPlugin()

    const disposable = plugin.activate(createContext(registerViewContribution))

    expect(plugin.name).toBe('scope-lines')
    expect(disposable).toBeDefined()
    expect(registerViewContribution).toHaveBeenCalledOnce()
  })

  it('returns no contribution when disabled', () => {
    const registration = registeredProvider(createScopeLinesPlugin({ enabled: false }))

    expect(registration?.createContribution(context())).toBeNull()
  })

  it('renders mounted fold scopes and active scope state', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const testContext = context(
      snapshot({
        selections: [
          { anchorOffset: 29, headOffset: 29, startOffset: 29, endOffset: 29, affinity: 'after' },
        ],
      }),
    )

    const contribution = registration?.createContribution(testContext)
    const lines = [...testContext.scrollElement.querySelectorAll<HTMLElement>('.editor-scope-line')]

    expect(contribution).not.toBeNull()
    expect(testContext.contentElement.querySelector('.editor-scope-lines')?.parentElement).toBe(
      testContext.contentElement,
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]?.style.left).toBe('0px')
    expect(lines[0]?.style.top).toBe('21px')
    expect(lines[0]?.style.height).toBe('56px')
    expect(lines[0]?.dataset.editorScopeLineLevel).toBe('1')
    expect(lines[0]?.classList.contains('editor-scope-line-active')).toBe(true)
    expect(lines[1]?.style.left).toBe('16px')
    expect(lines[1]?.style.top).toBe('41px')
    expect(lines[1]?.style.height).toBe('16px')
    expect(lines[1]?.dataset.editorScopeLineLevel).toBe('2')
    expect(lines[1]?.classList.contains('editor-scope-line-active')).toBe(true)

    contribution?.dispose()
    expect(testContext.scrollElement.querySelector('.editor-scope-lines')).toBeNull()
  })

  it('captures the mounted guide geometry and resolved active colors', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const viewSnapshot = snapshot({ gutterWidth: 48 })
    const testContext = context(viewSnapshot)
    const contribution = registration?.createContribution(testContext)
    document.body.appendChild(testContext.container)
    const style = document.createElement('style')
    style.textContent = `
      .editor-scope-line { width: 2px; background-color: rgb(10, 20, 30); }
      .editor-scope-line[data-editor-scope-line-level='2'] { background-color: rgb(70, 80, 90); }
      .editor-scope-line-active { background-color: rgb(40, 50, 60); }
      .editor-scope-line-active[data-editor-scope-line-level='2'] { background-color: rgb(100, 110, 120); }
    `
    document.head.appendChild(style)

    try {
      expect(contribution?.captureVisiblePaint?.(viewSnapshot)).toEqual({
        id: 'scope-lines',
        status: 'ready',
        rectangles: [
          { left: 48, top: 21, width: 2, height: 56, backgroundColor: 'rgb(10, 20, 30)' },
          { left: 64, top: 41, width: 2, height: 16, backgroundColor: 'rgb(70, 80, 90)' },
        ],
      })
      const active = snapshot({
        gutterWidth: 48,
        selections: [
          { anchorOffset: 29, headOffset: 29, startOffset: 29, endOffset: 29, affinity: 'after' },
        ],
      })
      contribution?.update(active, 'selection')
      expect(contribution?.captureVisiblePaint?.(active)).toMatchObject({
        status: 'ready',
        rectangles: [
          { backgroundColor: 'rgb(40, 50, 60)' },
          { backgroundColor: 'rgb(100, 110, 120)' },
        ],
      })
    } finally {
      contribution?.dispose()
      testContext.container.remove()
      style.remove()
    }
  })

  it('captures an enclosing scope whose opener and closer are outside mounted rows', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const viewSnapshot = snapshot({
      visibleRows: snapshot().visibleRows.slice(2, 3),
      gutterWidth: 48,
    })
    const testContext = context(viewSnapshot)
    const contribution = registration?.createContribution(testContext)
    const lines = testContext.scrollElement.querySelectorAll<HTMLElement>('.editor-scope-line')
    for (const line of lines) {
      line.style.width = '1px'
      line.style.backgroundColor = 'rgb(10, 20, 30)'
    }
    document.body.appendChild(testContext.container)

    try {
      expect(contribution?.captureVisiblePaint?.(viewSnapshot)).toEqual({
        id: 'scope-lines',
        status: 'ready',
        rectangles: [
          { left: 48, top: 41, width: 1, height: 16, backgroundColor: 'rgb(10, 20, 30)' },
          { left: 64, top: 41, width: 1, height: 16, backgroundColor: 'rgb(10, 20, 30)' },
        ],
      })
    } finally {
      contribution?.dispose()
      testContext.container.remove()
    }
  })

  it('keeps deferred content paint pending until the latest snapshot is committed', () => {
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback)
        return frames.length
      })
    const registration = registeredProvider(createScopeLinesPlugin())
    const initial = snapshot()
    const testContext = context(initial)
    const contribution = registration?.createContribution(testContext)
    const earlier = snapshot({ textVersion: 2, foldMarkers: [] })
    const latest = snapshot({ textVersion: 3, foldMarkers: [] })

    try {
      contribution?.update(earlier, 'content')
      contribution?.update(latest, 'content')
      expect(testContext.scrollElement.querySelectorAll('.editor-scope-line')).toHaveLength(2)
      expect(contribution?.captureVisiblePaint?.(latest)).toEqual({
        id: 'scope-lines',
        status: 'pending',
      })
      frames.shift()?.(0)
      expect(testContext.scrollElement.querySelectorAll('.editor-scope-line')).toHaveLength(0)
      expect(contribution?.captureVisiblePaint?.(latest)).toEqual({
        id: 'scope-lines',
        status: 'ready',
        rectangles: [],
      })
      expect(contribution?.captureVisiblePaint?.(earlier)).toEqual({
        id: 'scope-lines',
        status: 'pending',
      })
      expect(testContext.requestViewUpdate).toHaveBeenCalledOnce()
    } finally {
      contribution?.dispose()
      requestFrame.mockRestore()
    }
  })

  it.each([true, false])(
    'timer fallback defers and rechecks geometry committed=%s',
    (committed) => {
      vi.useFakeTimers()
      vi.stubGlobal('requestAnimationFrame', undefined)
      const testContext = context(snapshot())
      const contribution =
        registeredProvider(createScopeLinesPlugin())?.createContribution(testContext)
      const latest = snapshot({ textVersion: 2, foldMarkers: [] })
      try {
        contribution?.update(latest, 'content')
        expect(testContext.scrollElement.querySelectorAll('.editor-scope-line')).toHaveLength(2)
        testContext.getSnapshot = () => snapshot({ geometryCommitted: committed })
        vi.runAllTimers()
        expect(testContext.scrollElement.querySelectorAll('.editor-scope-line')).toHaveLength(
          committed ? 0 : 2,
        )
        expect(testContext.requestViewUpdate).toHaveBeenCalledTimes(committed ? 1 : 0)
        contribution?.update(latest, 'content')
        contribution?.dispose()
        vi.runAllTimers()
        expect(testContext.requestViewUpdate).toHaveBeenCalledTimes(committed ? 1 : 0)
      } finally {
        contribution?.dispose()
        vi.useRealTimers()
        vi.unstubAllGlobals()
      }
    },
  )

  it('omits guide segments with no visible width or height', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const viewSnapshot = snapshot()
    const testContext = context(viewSnapshot)
    const contribution = registration?.createContribution(testContext)
    document.body.appendChild(testContext.container)
    const lines = testContext.scrollElement.querySelectorAll<HTMLElement>('.editor-scope-line')
    lines.forEach((line, index) => {
      line.style.width = `${index}px`
      line.style.backgroundColor = 'rgb(10, 20, 30)'
    })

    try {
      expect(contribution?.captureVisiblePaint?.(viewSnapshot)).toEqual({
        id: 'scope-lines',
        status: 'ready',
        rectangles: [
          { left: 16, top: 41, width: 1, height: 16, backgroundColor: 'rgb(10, 20, 30)' },
        ],
      })
      const shortRows = snapshot({
        visibleRows: viewSnapshot.visibleRows.slice(2, 3).map((row) => ({ ...row, height: 4 })),
      })
      contribution?.update(shortRows, 'layout')
      expect(contribution?.captureVisiblePaint?.(shortRows)).toEqual({
        id: 'scope-lines',
        status: 'ready',
        rectangles: [],
      })
    } finally {
      contribution?.dispose()
      testContext.container.remove()
    }
  })

  it('does not capture an empty layer while structural syntax is loading', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const loading = snapshot({ foldMarkers: [], syntaxStatus: 'loading' })
    const testContext = context(loading)
    const contribution = registration?.createContribution(testContext)

    expect(contribution?.captureVisiblePaint?.(loading)).toEqual({
      id: 'scope-lines',
      status: 'pending',
    })
    const ready = snapshot({ foldMarkers: [], syntaxStatus: 'ready' })
    contribution?.update(ready, 'tokens')
    expect(contribution?.captureVisiblePaint?.(ready)).toEqual({
      id: 'scope-lines',
      status: 'ready',
      rectangles: [],
    })
    contribution?.dispose()
  })

  it('aligns scope guides to the configured indent step', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const text = 'function f() {\n    if (x) {\n        y()\n    }\n}\n'
    const testContext = context(
      snapshot({
        text,
        lineStarts: lineStarts(text),
        lineCount: 6,
        tabSize: 4,
        foldMarkers: fourSpaceFoldMarkers(text),
        visibleRows: visibleRows(text),
      }),
    )

    registration?.createContribution(testContext)

    const lines = [...testContext.scrollElement.querySelectorAll<HTMLElement>('.editor-scope-line')]
    expect(lines).toHaveLength(2)
    expect(lines[0]?.style.left).toBe('0px')
    expect(lines[1]?.style.left).toBe('32px')
  })

  it('places a guide at the shallowest body indentation, not the first line it finds', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const text = 'if (x) {\n    deep()\n  shallow()\n}\n'
    const starts = lineStarts(text)
    const testContext = context(
      snapshot({
        text,
        lineStarts: starts,
        lineCount: starts.length,
        foldMarkers: [
          {
            key: 'if:0:33',
            startOffset: starts[0]!,
            endOffset: starts[3]!,
            startRow: 0,
            endRow: 3,
            collapsed: false,
          },
        ],
        visibleRows: visibleRows(text),
      }),
    )

    registration?.createContribution(testContext)

    const lines = [...testContext.scrollElement.querySelectorAll<HTMLElement>('.editor-scope-line')]
    expect(lines).toHaveLength(1)
    expect(lines[0]?.style.left).toBe('0px')
    expect(lines[0]?.dataset.editorScopeLineLevel).toBe('1')
  })

  it('caches row text within a render pass', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const text = 'function f() {\n  if (x) {\n    y()\n  }\n}\n'
    const starts = lineStarts(text)
    const readRows: number[] = []
    const testContext = context(
      snapshot({
        text,
        textSnapshot: countingTextSnapshot(text, starts, readRows),
        lineStarts: starts,
        foldMarkers: foldMarkers(),
        visibleRows: visibleRows(text),
      }),
    )

    registration?.createContribution(testContext)

    expect(readRows.filter((row) => row === 1)).toHaveLength(1)
  })

  it('skips text reads for fold markers outside the mounted rows', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const text = 'root\n  one\n  two\nend\n\nfar\n  child\n  next\nend\n'
    const starts = lineStarts(text)
    const readRows: number[] = []
    const testContext = context(
      snapshot({
        text,
        textSnapshot: countingTextSnapshot(text, starts, readRows),
        lineStarts: starts,
        lineCount: starts.length,
        foldMarkers: [
          {
            key: 'visible',
            startOffset: starts[0]!,
            endOffset: starts[3]!,
            startRow: 0,
            endRow: 3,
            collapsed: false,
          },
          {
            key: 'offscreen',
            startOffset: starts[5]!,
            endOffset: starts[8]!,
            startRow: 5,
            endRow: 8,
            collapsed: false,
          },
        ],
        visibleRows: visibleRows(text).slice(0, 4),
      }),
    )

    registration?.createContribution(testContext)

    expect(readRows).toContain(1)
    expect(readRows).not.toContain(5)
    expect(readRows).not.toContain(6)
  })

  it('skips collapsed scopes', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const marker = foldMarkers()[0]!
    const testContext = context(
      snapshot({
        foldMarkers: [{ ...marker, collapsed: true }],
      }),
    )

    registration?.createContribution(testContext)

    expect(testContext.scrollElement.querySelectorAll('.editor-scope-line')).toHaveLength(0)
  })

  it('updates active scope after selection changes', () => {
    const registration = registeredProvider(createScopeLinesPlugin())
    const inactive = snapshot({
      selections: [
        { anchorOffset: 0, headOffset: 0, startOffset: 0, endOffset: 0, affinity: 'after' },
      ],
    })
    const testContext = context(inactive)
    const contribution = registration?.createContribution(testContext)

    expect(testContext.scrollElement.querySelector('.editor-scope-line-active')).toBeNull()

    contribution?.update(
      snapshot({
        selections: [
          { anchorOffset: 29, headOffset: 29, startOffset: 29, endOffset: 29, affinity: 'after' },
        ],
      }),
      'selection',
    )

    expect(testContext.scrollElement.querySelectorAll('.editor-scope-line-active')).toHaveLength(2)
  })

  it('keeps scope line nodes when content edits leave guide geometry unchanged', () => {
    const frames: FrameRequestCallback[] = []
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const registration = registeredProvider(createScopeLinesPlugin())
    const testContext = context(
      snapshot({
        selections: [
          { anchorOffset: 29, headOffset: 29, startOffset: 29, endOffset: 29, affinity: 'after' },
        ],
      }),
    )
    const contribution = registration?.createContribution(testContext)
    const originalLines = [
      ...testContext.scrollElement.querySelectorAll<HTMLElement>('.editor-scope-line'),
    ]

    contribution?.update(
      snapshot({
        textVersion: 2,
        foldMarkers: shiftedFoldMarkers(1),
        selections: [
          { anchorOffset: 30, headOffset: 30, startOffset: 30, endOffset: 30, affinity: 'after' },
        ],
      }),
      'content',
    )

    frames.shift()?.(0)
    expect(testContext.requestViewUpdate).toHaveBeenCalledOnce()
    request.mockRestore()
    const nextLines = [
      ...testContext.scrollElement.querySelectorAll<HTMLElement>('.editor-scope-line'),
    ]
    expect(nextLines[0]).toBe(originalLines[0])
    expect(nextLines[1]).toBe(originalLines[1])
    contribution?.dispose()
  })

  it('renders only the nearest cursor scope in current mode', () => {
    const registration = registeredProvider(createScopeLinesPlugin({ mode: 'current' }))
    const testContext = context(
      snapshot({
        selections: [
          { anchorOffset: 29, headOffset: 29, startOffset: 29, endOffset: 29, affinity: 'after' },
        ],
      }),
    )

    registration?.createContribution(testContext)

    const lines = [...testContext.scrollElement.querySelectorAll<HTMLElement>('.editor-scope-line')]
    expect(lines).toHaveLength(1)
    expect(lines[0]?.style.left).toBe('16px')
    expect(lines[0]?.dataset.editorScopeLineLevel).toBe('2')
    expect(lines[0]?.classList.contains('editor-scope-line-active')).toBe(true)
  })

  it('renders no current-mode scope when the cursor is outside fold ranges', () => {
    const registration = registeredProvider(createScopeLinesPlugin({ mode: 'current' }))
    const testContext = context(
      snapshot({
        selections: [
          { anchorOffset: 0, headOffset: 0, startOffset: 0, endOffset: 0, affinity: 'after' },
        ],
      }),
    )

    registration?.createContribution(testContext)

    expect(testContext.scrollElement.querySelectorAll('.editor-scope-line')).toHaveLength(0)
  })

  it('keeps current-mode rendering separate from active styling', () => {
    const registration = registeredProvider(
      createScopeLinesPlugin({ mode: 'current', showActive: false }),
    )
    const testContext = context(
      snapshot({
        selections: [
          { anchorOffset: 29, headOffset: 29, startOffset: 29, endOffset: 29, affinity: 'after' },
        ],
      }),
    )

    registration?.createContribution(testContext)

    expect(testContext.scrollElement.querySelectorAll('.editor-scope-line')).toHaveLength(1)
    expect(testContext.scrollElement.querySelector('.editor-scope-line-active')).toBeNull()
  })
})

function registeredProvider(plugin: ReturnType<typeof createScopeLinesPlugin>) {
  let registration: EditorViewContributionProvider | undefined
  plugin.activate(
    createContext((provider) => {
      registration = provider
      return { dispose: vi.fn() }
    }),
  )
  return registration
}

function createContext(
  registerViewContribution: EditorPluginContext['registerViewContribution'],
): EditorPluginContext {
  return createTestPluginContext({
    registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
    registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerViewContribution,
    registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerCapabilityContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
  })
}

function context(viewSnapshot = snapshot()): EditorViewContributionContext {
  const container = document.createElement('div')
  const scrollElement = document.createElement('div')
  const contentElement = document.createElement('div')
  scrollElement.appendChild(contentElement)
  container.appendChild(scrollElement)
  return createTestViewContributionContext({
    container,
    scrollElement,
    contentElement,
    getSnapshot: () => viewSnapshot,
    requestViewUpdate: vi.fn(),
  })
}

function snapshot({
  text = 'function f() {\n  if (x) {\n    y()\n  }\n}\n',
  ...overrides
}: Partial<EditorViewSnapshot> & { readonly text?: string } = {}): EditorViewSnapshot {
  return {
    documentId: 'scope-test',
    languageId: 'typescript',
    syntaxStatus: 'ready',
    paintLayers: [],
    ...createTestViewSnapshotSource(text),
    textVersion: 1,
    lineStarts: lineStarts(text),
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: 6,
    contentWidth: 160,
    totalHeight: 120,
    tabSize: 2,
    foldMarkers: foldMarkers(),
    visibleRows: visibleRows(text),
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 120,
      scrollWidth: 160,
      clientHeight: 80,
      clientWidth: 120,
      borderBoxHeight: 80,
      borderBoxWidth: 120,
      visibleRange: { start: 0, end: 6 },
    },
    ...overrides,
    initialHighlightStatus: overrides.initialHighlightStatus ?? 'painted',
    gutterWidth: overrides.gutterWidth ?? 0,
    gutterLayout: overrides.gutterLayout ?? { leadingInset: 0, fixedWidth: 0, lanes: [] },
    toVisibleSnapshot: overrides.toVisibleSnapshot ?? (() => null),
    documentSyncPoint: overrides.documentSyncPoint ?? {
      revision: overrides.textVersion ?? 1,
      segment: TEST_DOCUMENT_SYNC_SEGMENT,
      textVersion: overrides.textVersion ?? 1,
    },
    changesSinceDocumentSyncPoint: overrides.changesSinceDocumentSyncPoint ?? (() => null),
  }
}

function foldMarkers(): readonly VirtualizedFoldMarker[] {
  return [
    {
      key: 'function:0:40',
      startOffset: 0,
      endOffset: 40,
      startRow: 0,
      endRow: 4,
      collapsed: false,
    },
    {
      key: 'if:15:38',
      startOffset: 15,
      endOffset: 38,
      startRow: 1,
      endRow: 3,
      collapsed: false,
    },
  ]
}

function shiftedFoldMarkers(delta: number): readonly VirtualizedFoldMarker[] {
  return foldMarkers().map((marker) => ({
    ...marker,
    key: `${marker.key}:${delta}`,
    endOffset: marker.endOffset + delta,
  }))
}

function fourSpaceFoldMarkers(text: string): readonly VirtualizedFoldMarker[] {
  const starts = lineStarts(text)
  return [
    {
      key: 'function:0:52',
      startOffset: starts[0]!,
      endOffset: text.length,
      startRow: 0,
      endRow: 4,
      collapsed: false,
    },
    {
      key: 'if:18:50',
      startOffset: starts[1]!,
      endOffset: starts[4]!,
      startRow: 1,
      endRow: 3,
      collapsed: false,
    },
  ]
}

function visibleRows(text: string): EditorViewSnapshot['visibleRows'] {
  const starts = lineStarts(text)
  return starts.map((start, index) => {
    const nextStart = starts[index + 1] ?? text.length + 1
    const end = Math.max(start, Math.min(text.length, nextStart - 1))
    return {
      index,
      bufferRow: index,
      source: 'document',
      startOffset: start,
      endOffset: end,
      text: text.slice(start, end),
      kind: 'text',
      primaryText: true,
      firstWrapSegment: true,
      top: index * 20,
      height: 20,
      leftSpacerWidth: 0,
      contentCursorLine: false,
      gutterNumberCursorLine: false,
      gutterCursorLineBackgroundLaneIds: [],
      mountedPaintSupport: 'replayable',
      chunks: [],
      foldMarker: null,
    }
  })
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function countingTextSnapshot(
  text: string,
  starts: readonly number[],
  readRows: number[],
): TextSnapshot {
  return Object.assign(createStringTextSnapshot(text), {
    materializeFullText: () => {
      throw new Error('unexpected full text materialization')
    },
    readRange: (start: number, end: number) => {
      readRows.push(starts.indexOf(start))
      return text.slice(start, end)
    },
  })
}
