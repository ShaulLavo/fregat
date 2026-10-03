import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorWidgetKeymap } from '@singapore-editor/core/extensions'
import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import type {
  EditorMinimapDecoration,
  EditorMinimapFeature,
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { EDITOR_MINIMAP_FEATURE } from '@singapore-editor/core/extensions'
import type { VirtualizedTextHighlightStyle } from '@singapore-editor/core/rendering'
import { createEditorFindContributionProviders } from '../src'
import {
  createTestCapabilityContributionContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

const keymaps: ReturnType<typeof createEditorWidgetKeymap>[] = []
const containers: HTMLElement[] = []
afterEach(() => {
  for (const keymap of keymaps.splice(0)) keymap.dispose()
  for (const container of containers.splice(0)) container.remove()
})

const MINIMAP_MATCH_SOURCE = 'editor-find-test-find-match'
const MINIMAP_CURRENT_SOURCE = 'editor-find-test-find-current'
const MINIMAP_SCOPE_SOURCE = 'editor-find-test-find-scope'

describe('find minimap markers', () => {
  it('marks the rows every match sits on', () => {
    const minimap = minimapRegistry()
    const context = viewContext(minimap, 'foo\nbar\nfoo baz\nqux\n')
    const providers = createEditorFindContributionProviders({
      seedSearchStringFromSelection: 'never',
    })
    const contribution = providers.view.createContribution(context)

    openFind(providers)
    typeSearch(context, 'foo')

    expect(minimap.get(MINIMAP_MATCH_SOURCE)?.map(rows)).toEqual([
      [1, 1],
      [3, 3],
    ])
    expect(minimap.get(MINIMAP_CURRENT_SOURCE)?.map(rows)).toEqual([[1, 1]])

    contribution?.dispose()
  })

  it('paints a band in the colour the matches are highlighted in', () => {
    const minimap = minimapRegistry()
    const context = viewContext(minimap, 'foo\nfoo\n')
    const providers = createEditorFindContributionProviders({
      seedSearchStringFromSelection: 'never',
    })
    const contribution = providers.view.createContribution(context)

    openFind(providers)
    typeSearch(context, 'foo')

    const style = highlightStyle(context, MINIMAP_MATCH_SOURCE)
    // A worker has no style engine, so a band carrying anything but a literal
    // would be painted in the selection colour instead.
    expect(style?.backgroundColor).toMatch(/^rgba?\(/)
    expect(minimap.get(MINIMAP_MATCH_SOURCE)?.[0]).toMatchObject({
      color: style?.backgroundColor,
      position: 'inline',
    })

    contribution?.dispose()
  })

  it('keeps a range ending at a line start off the row that follows it', () => {
    const minimap = minimapRegistry()
    const context = viewContext(minimap, 'aa\nbb\ncc\n', [0, 6])
    const providers = createEditorFindContributionProviders({
      seedSearchStringFromSelection: 'never',
    })
    const contribution = providers.view.createContribution(context)

    openFind(providers)
    clickScope(context)

    expect(minimap.get(MINIMAP_SCOPE_SOURCE)?.map(rows)).toEqual([[1, 2]])

    contribution?.dispose()
  })

  it('drops its marks when find closes', () => {
    const minimap = minimapRegistry()
    const context = viewContext(minimap, 'foo\nfoo\n')
    const providers = createEditorFindContributionProviders({
      seedSearchStringFromSelection: 'never',
    })
    const contribution = providers.view.createContribution(context)

    openFind(providers)
    typeSearch(context, 'foo')
    expect(minimap.get(MINIMAP_MATCH_SOURCE)).toHaveLength(2)

    closeFind(context)

    expect(minimap.get(MINIMAP_MATCH_SOURCE)).toBeUndefined()

    contribution?.dispose()
  })
})

type MinimapRegistry = EditorMinimapFeature & {
  get(sourceId: string): readonly EditorMinimapDecoration[] | undefined
}

function minimapRegistry(): MinimapRegistry {
  const sources = new Map<string, readonly EditorMinimapDecoration[]>()
  return {
    get: (sourceId) => sources.get(sourceId),
    setDecorations: (sourceId, decorations) => void sources.set(sourceId, decorations),
    clearDecorations: (sourceId) => void sources.delete(sourceId),
    getDecorations: () => Array.from(sources.values()).flat(),
    subscribe: () => ({ dispose: vi.fn() }),
  }
}

function rows(decoration: EditorMinimapDecoration): readonly number[] {
  return [decoration.startLineNumber, decoration.endLineNumber]
}

function openFind(providers: ReturnType<typeof createEditorFindContributionProviders>): void {
  const features: { openFind(): boolean }[] = []
  providers.capability.createContribution(
    createTestCapabilityContributionContext({
      registerFeature: (_token, feature) => {
        features.push(feature as { openFind(): boolean })
        return { dispose: vi.fn() }
      },
    }),
  )
  features[0]?.openFind()
}

function typeSearch(context: EditorViewContributionContext, value: string): void {
  const input = context.container.querySelector<HTMLInputElement>(
    '.editor-find-input:not(.editor-find-input-standalone)',
  )
  if (!input) throw new Error('missing find input')

  for (const character of value) {
    input.value += character
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function closeFind(context: EditorViewContributionContext): void {
  const input = context.container.querySelector<HTMLInputElement>(
    '.editor-find-input:not(.editor-find-input-standalone)',
  )
  input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

// Addressed by the icon it renders, which outlives the label a toggle rewrites
// every time it is pressed.
function clickScope(context: EditorViewContributionContext): void {
  for (const button of context.container.querySelectorAll<HTMLButtonElement>(
    '.editor-find-button',
  )) {
    if (button.querySelector('[data-icon="selection"]')) {
      button.click()
      return
    }
  }

  throw new Error('missing find scope toggle')
}

function highlightStyle(
  context: EditorViewContributionContext,
  name: string,
): VirtualizedTextHighlightStyle | undefined {
  const setRangeHighlight = context.setRangeHighlight
  if (!setRangeHighlight) return undefined

  return vi.mocked(setRangeHighlight).mock.calls.findLast(([called]) => called === name)?.[2]
}

function viewContext(
  minimap: EditorMinimapFeature,
  text: string,
  selection: readonly [number, number] = [0, 0],
): EditorViewContributionContext {
  const container = document.createElement('div')
  document.body.append(container)
  containers.push(container)
  const scrollElement = document.createElement('div')
  container.appendChild(scrollElement)
  const viewSnapshot = snapshot(text, selection)
  const keymap = createEditorWidgetKeymap(container)
  keymaps.push(keymap)

  return createTestViewContributionContext({
    container,
    scrollElement,
    contentElement: scrollElement,
    registerKeymapNode: keymap.registerKeymapNode,
    highlightPrefix: 'editor-find-test',
    getSnapshot: () => viewSnapshot,
    getFeature: <T>(token: unknown) => (token === EDITOR_MINIMAP_FEATURE ? (minimap as T) : null),
    setRangeHighlight: vi.fn(),
  })
}

function snapshot(text: string, selection: readonly [number, number]): EditorViewSnapshot {
  const lineStarts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1)
  }

  return {
    documentId: 'find-minimap-test',
    languageId: null,
    ...createTestViewSnapshotSource(text),
    textVersion: 1,
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    documentSyncPoint: {
      revision: 1,
      segment: Object.freeze({}) as EditorViewSnapshot['documentSyncPoint']['segment'],
      textVersion: 1,
    },
    changesSinceDocumentSyncPoint: () => null,
    lineStarts,
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [
      {
        anchorOffset: selection[0],
        headOffset: selection[1],
        startOffset: Math.min(...selection),
        endOffset: Math.max(...selection),
        affinity: 'after',
      },
    ],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: lineStarts.length,
    contentWidth: 88,
    totalHeight: lineStarts.length * 20,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 2,
    foldMarkers: [],
    visibleRows: [],
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: lineStarts.length * 20,
      scrollWidth: 88,
      clientHeight: 200,
      clientWidth: 88,
      visibleRange: { start: 0, end: lineStarts.length },
    },
    toVisibleSnapshot() {
      return null
    },
  }
}
