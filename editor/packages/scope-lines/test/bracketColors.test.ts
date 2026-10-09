import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import { EditorTokenStore, type BracketInfo } from '@singapore-editor/core/syntax'
import {
  applyEditorTheme,
  type VirtualizedTextHighlightStyle,
} from '@singapore-editor/core/rendering'
import type {
  EditorPlugin,
  EditorPluginContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { createBracketColorsPlugin, createScopeLinesPlugin } from '../src/index'
import {
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

type PaintedHighlight = {
  readonly name: string
  readonly ranges: readonly { readonly start: number; readonly end: number }[]
  readonly style: VirtualizedTextHighlightStyle
}

type TestContext = ReturnType<typeof context>
const TEST_DOCUMENT_SYNC_SEGMENT = Object.freeze(
  {},
) as EditorViewSnapshot['documentSyncPoint']['segment']

afterEach(() => {
  document.head.querySelectorAll('style').forEach((element) => element.remove())
})

describe('createBracketColorsPlugin', () => {
  it('paints nesting depth through the level palette', () => {
    const text = '{ a([1, 2]) }'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))

    contribution(createBracketColorsPlugin(), testContext)

    expect(rangesFor(testContext, 'editor-bracket-level-0')).toEqual([
      { start: 0, end: 1 },
      { start: 12, end: 13 },
    ])
    expect(rangesFor(testContext, 'editor-bracket-level-1')).toEqual([
      { start: 3, end: 4 },
      { start: 10, end: 11 },
    ])
    expect(rangesFor(testContext, 'editor-bracket-level-2')).toEqual([
      { start: 4, end: 5 },
      { start: 9, end: 10 },
    ])
  })

  it('paints each level with its own registered colour', () => {
    const text = '{ a([1, 2]) }'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))

    contribution(createBracketColorsPlugin(), testContext)

    expect(styleFor(testContext, 'editor-bracket-level-0').color).toBe(
      'var(--editor-brackets-level0)',
    )
    expect(styleFor(testContext, 'editor-bracket-level-1').color).toBe(
      'var(--editor-brackets-level1)',
    )
  })

  it('outranks the colour the grammar gave the bracket', () => {
    const text = 'a) { b }'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))

    contribution(createBracketColorsPlugin(), testContext)

    expect(styleFor(testContext, 'editor-bracket-level-0').zIndex).toBe(1)
    expect(styleFor(testContext, 'editor-bracket-unexpected').zIndex).toBe(1)
  })

  it('derives each level colour from the theme rather than from a literal', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    applyEditorTheme(element, null)

    // Every level in palette order: a palette that collapsed onto one syntax colour, or that ran
    // shorter than the rotation the depth counter walks, would still light up any single level.
    expect(levelColorDefaults()).toEqual([
      'var(--editor-syntax-type, var(--editor-syntax-bracket))',
      'var(--editor-syntax-keyword, var(--editor-syntax-bracket))',
      'var(--editor-syntax-string, var(--editor-syntax-bracket))',
      'var(--editor-syntax-number, var(--editor-syntax-bracket))',
      'var(--editor-syntax-function, var(--editor-syntax-bracket))',
      'var(--editor-syntax-variable-builtin, var(--editor-syntax-bracket))',
    ])
    element.remove()
  })

  it('rotates back to the first colour once the palette runs out', () => {
    const text = '((((((()))))))'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))

    contribution(createBracketColorsPlugin(), testContext)

    expect(rangesFor(testContext, 'editor-bracket-level-0')).toEqual([
      { start: 0, end: 1 },
      { start: 6, end: 7 },
      { start: 7, end: 8 },
      { start: 13, end: 14 },
    ])
  })

  it('leaves brackets below the level cap alone', () => {
    const text = '{ [ ( ) ] }'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))

    contribution(createBracketColorsPlugin({ maxLevel: 2 }), testContext)

    expect(rangesFor(testContext, 'editor-bracket-level-1')).toEqual([
      { start: 2, end: 3 },
      { start: 8, end: 9 },
    ])
    expect(rangesFor(testContext, 'editor-bracket-level-2')).toEqual([])
  })

  it('leaves a document with more brackets than the cap uncoloured', () => {
    const text = '{ [ ( ) ] }'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))

    contribution(createBracketColorsPlugin({ maxBrackets: 5 }), testContext)

    expect(paintedRanges(testContext)).toEqual([])
  })

  it('marks a closer with nothing to close instead of colouring it by depth', () => {
    const text = 'a) fn(b)'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))

    contribution(createBracketColorsPlugin(), testContext)

    expect(rangesFor(testContext, 'editor-bracket-unexpected')).toEqual([{ start: 1, end: 2 }])
    expect(styleFor(testContext, 'editor-bracket-unexpected').color).toBe(
      'var(--editor-brackets-unexpected)',
    )
    expect(rangesFor(testContext, 'editor-bracket-level-0')).toEqual([
      { start: 5, end: 6 },
      { start: 7, end: 8 },
    ])
  })

  it('repaints when a parse ships new brackets and not when the caret moves', () => {
    const text = 'fn(a)'
    const first = snapshot({ text: text, brackets: bracketsFor(text) })
    const testContext = context(first)
    const live = contribution(createBracketColorsPlugin(), testContext)
    const paintedOnMount = testContext.painted.length

    live?.update(first, 'selection')
    expect(testContext.painted).toHaveLength(paintedOnMount)

    live?.update(snapshot({ text: '{fn(a)}', brackets: bracketsFor('{fn(a)}') }), 'content')
    expect(rangesFor(testContext, 'editor-bracket-level-1')).toEqual([
      { start: 3, end: 4 },
      { start: 5, end: 6 },
    ])
  })

  it('clears every level group when it is disposed', () => {
    const text = 'fn(a)'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))
    const live = contribution(createBracketColorsPlugin(), testContext)

    live?.dispose()

    expect(testContext.cleared).toContain('editor-bracket-level-0')
    expect(testContext.cleared).toContain('editor-bracket-unexpected')
  })

  it('contributes nothing when it is disabled', () => {
    const registration = registeredProvider(createBracketColorsPlugin({ enabled: false }))

    expect(registration?.createContribution(context())).toBeNull()
  })

  it('is not part of the scope guides, which paint no bracket colours of their own', () => {
    const text = '{ a([1, 2]) }'
    const testContext = context(snapshot({ text: text, brackets: bracketsFor(text) }))

    contribution(createScopeLinesPlugin(), testContext)

    expect(paintedRanges(testContext)).toEqual([])
  })
})

function contribution(plugin: EditorPlugin, testContext: TestContext) {
  return registeredProvider(plugin)?.createContribution(testContext)
}

function registeredProvider(plugin: EditorPlugin) {
  let registration: EditorViewContributionProvider | undefined
  plugin.activate(
    createPluginContext((provider) => {
      registration = provider
      return { dispose: vi.fn() }
    }),
  )
  return registration
}

function rangesFor(testContext: TestContext, name: string) {
  return testContext.painted.findLast((highlight) => highlight.name === name)?.ranges ?? []
}

function styleFor(testContext: TestContext, name: string): VirtualizedTextHighlightStyle {
  return testContext.painted.findLast((highlight) => highlight.name === name)?.style ?? {}
}

function paintedRanges(testContext: TestContext) {
  return testContext.painted.flatMap((highlight) => [...highlight.ranges])
}

function generatedColorRules(): string {
  return Array.from(
    document.head.querySelectorAll('style'),
    (element) => element.textContent ?? '',
  ).join('\n')
}

/** The value declared for every `brackets.levelN` id there is, ordered by N. */
function levelColorDefaults(): string[] {
  const declarations = [
    ...generatedColorRules().matchAll(
      /^\[data-editor-colors\] \{ --editor-brackets-level(\d+): (.+); \}$/gm,
    ),
  ]
  return declarations
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((declaration) => declaration[2] ?? '')
}

function createPluginContext(
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

function context(viewSnapshot = snapshot()) {
  const painted: PaintedHighlight[] = []
  const cleared: string[] = []

  return {
    ...createTestViewContributionContext({
      highlightPrefix: 'editor',
      getSnapshot: () => viewSnapshot,
      setRangeHighlight: (name, ranges, style) => {
        if (ranges.length === 0) return
        painted.push({ name, ranges: [...ranges], style })
      },
      clearRangeHighlight: (name) => {
        cleared.push(name)
      },
    }),
    painted,
    cleared,
  }
}

function snapshot({
  text = 'fn(a)',
  ...overrides
}: Partial<EditorViewSnapshot> & { readonly text?: string } = {}): EditorViewSnapshot {
  return {
    documentId: 'bracket-colors-test',
    languageId: 'typescript',
    syntaxStatus: 'ready',
    paintLayers: [],
    ...createTestViewSnapshotSource(text),
    textVersion: 1,
    lineStarts: [0],
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: 1,
    contentWidth: 160,
    totalHeight: 20,
    tabSize: 2,
    foldMarkers: [],
    visibleRows: [
      {
        index: 0,
        bufferRow: 0,
        source: 'document',
        startOffset: 0,
        endOffset: text.length,
        text,
        kind: 'text',
        primaryText: true,
        firstWrapSegment: true,
        top: 0,
        height: 20,
        leftSpacerWidth: 0,
        contentCursorLine: false,
        gutterNumberCursorLine: false,
        gutterCursorLineBackgroundLaneIds: [],
        mountedPaintSupport: 'replayable',
        chunks: [],
        foldMarker: null,
      },
    ],
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 20,
      scrollWidth: 160,
      clientHeight: 20,
      clientWidth: 160,
      borderBoxHeight: 20,
      borderBoxWidth: 160,
      visibleRange: { start: 0, end: 1 },
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

/**
 * The bracket list the syntax worker would ship for `text`, including its depth field: the plugin has
 * to reach its own answer from the offsets, so a fixture that handed it a trustworthy depth would
 * hide the whole point.
 */
function bracketsFor(text: string): BracketInfo[] {
  const pairs: Record<string, string | undefined> = { '(': ')', '[': ']', '{': '}' }
  const closers = new Set(Object.values(pairs))
  const stack: string[] = []
  const brackets: BracketInfo[] = []

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === undefined) continue

    if (pairs[char] !== undefined) {
      stack.push(char)
      brackets.push({ char, depth: stack.length, index })
      continue
    }
    if (!closers.has(char)) continue

    const depth = stack.length > 0 ? stack.length : 1
    const top = stack[stack.length - 1]
    if (top !== undefined && pairs[top] === char) stack.pop()
    brackets.push({ char, depth, index })
  }

  return brackets
}
