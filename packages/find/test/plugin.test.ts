import { EditorTokenStore } from '@singapore-editor/core/syntax'
import { describe, expect, it, vi } from 'vitest'
import { createTestViewSnapshotSource } from '@singapore-editor/core/testing'
import type {
  EditorCapabilityContributionProvider,
  EditorCommandContributionProvider,
  EditorEditContributionProvider,
  EditorOverlaySide,
  EditorPluginContext,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  createEditorFindContributionProviders,
  createEditorFindPlugin,
  EDITOR_FIND_FEATURE,
  type EditorFindContributionProviders,
} from '../src'
import {
  createTestCapabilityContributionContext,
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

describe('createEditorFindPlugin', () => {
  it('registers public find contribution providers', () => {
    const context = pluginContext()
    const plugin = createEditorFindPlugin()

    const disposable = plugin.activate(context)

    expect(plugin.name).toBe('editor.find')
    expect(disposable).toBeDefined()
    expect(context.registerViewContribution).toHaveBeenCalledOnce()
    expect(context.registerCommandContribution).toHaveBeenCalledOnce()
    expect(context.registerCapabilityContribution).toHaveBeenCalledOnce()
    expect(context.registerEditContribution).toHaveBeenCalledOnce()
  })

  it('exposes a provider factory with a find capability contribution', () => {
    const providers = createEditorFindContributionProviders()
    const registrations: { readonly token: unknown; readonly feature: unknown }[] = []

    const contribution = providers.capability.createContribution(
      createTestCapabilityContributionContext({
        registerFeature: (token, feature) => {
          registrations.push({ token, feature })
          return { dispose: vi.fn() }
        },
      }),
    )

    expect(registrations).toEqual([
      {
        token: EDITOR_FIND_FEATURE,
        feature: expect.objectContaining({
          openFind: expect.any(Function),
          toggleFind: expect.any(Function),
          replaceAll: expect.any(Function),
        }),
      },
    ])

    contribution?.dispose()
  })

  it('registers the find command surface through a command contribution', () => {
    const providers = createEditorFindContributionProviders()
    const registeredCommands: string[] = []
    const registerCommand = vi.fn((command: string) => {
      registeredCommands.push(command)
      return { dispose: vi.fn() }
    })

    const contribution = providers.command.createContribution({ registerCommand })

    expect(registeredCommands).toEqual([
      'find',
      'findReplace',
      'findNext',
      'findPrevious',
      'closeFind',
      'toggleFindCaseSensitive',
      'toggleFindWholeWord',
      'toggleFindRegex',
      'toggleFindInSelection',
      'togglePreserveCase',
      'replaceOne',
      'replaceAll',
      'selectAllMatches',
    ])

    contribution?.dispose()
  })

  it('keeps widget creation lazy until find opens', () => {
    const providers = createEditorFindContributionProviders()
    const context = viewContext()
    const features: { openFind(): boolean }[] = []
    const viewContribution = providers.view.createContribution(context)

    providers.capability.createContribution(
      createTestCapabilityContributionContext({
        registerFeature: (_token, value) => {
          features.push(value as { openFind(): boolean })
          return { dispose: vi.fn() }
        },
      }),
    )

    const feature = features[0]
    expect(context.container.querySelector('.editor-find-widget')).toBeNull()
    expect(feature?.openFind()).toBe(true)
    expect(context.container.querySelector('.editor-find-widget')).not.toBeNull()

    viewContribution?.dispose()
  })

  it('insets the widget past overlay width already reserved on its edge', () => {
    const providers = createEditorFindContributionProviders()
    const context = viewContext()
    const viewContribution = providers.view.createContribution(context)

    context.reserveOverlayWidth('right', 120)
    openFindWidget(providers)

    expect(findWidgetElement(context).style.marginRight).toBe('120px')

    viewContribution?.dispose()
  })

  it('anchors before the native scrollbar and updates when its width changes', () => {
    const providers = createEditorFindContributionProviders()
    const context = viewContext()
    Object.defineProperties(context.container, {
      clientLeft: { value: 3 },
      clientWidth: { value: 642 },
    })
    Object.defineProperties(context.scrollElement, {
      clientLeft: { value: 7 },
      clientWidth: { value: 578, configurable: true },
    })
    vi.spyOn(context.container, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(10, 0, 650, 200),
    )
    vi.spyOn(context.scrollElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(25, 0, 620, 200),
    )
    const contribution = providers.view.createContribution(context)
    context.reserveOverlayWidth('right', 120)
    openFindWidget(providers)

    expect(findWidgetElement(context).style.marginRight).toBe('165px')

    Object.defineProperty(context.scrollElement, 'clientWidth', { value: 608 })
    contribution?.update(context.getSnapshot(), 'layout')

    expect(findWidgetElement(context).style.marginRight).toBe('135px')
    contribution?.dispose()
  })

  // No update call follows the claim here: the host announces it only through the width event.
  it('follows a reservation announced outside any update', () => {
    const providers = createEditorFindContributionProviders()
    const context = viewContext()
    const viewContribution = providers.view.createContribution(context)
    openFindWidget(providers)
    viewContribution?.update(context.getSnapshot(), 'layout')

    context.reserveOverlayWidth('right', 64)

    expect(findWidgetElement(context).style.marginRight).toBe('64px')
    viewContribution?.dispose()
  })

  it('releases its reservation listener on dispose', () => {
    const providers = createEditorFindContributionProviders()
    const context = viewContext()
    const viewContribution = providers.view.createContribution(context)
    openFindWidget(providers)
    expect(context.widthListeners.size).toBe(1)

    viewContribution?.dispose()

    expect(context.widthListeners.size).toBe(0)
  })
})

function openFindWidget(providers: EditorFindContributionProviders): void {
  const features: { openFind(): boolean }[] = []
  providers.capability.createContribution(
    createTestCapabilityContributionContext({
      registerFeature: (_token, value) => {
        features.push(value as { openFind(): boolean })
        return { dispose: vi.fn() }
      },
    }),
  )
  features[0]?.openFind()
}

// The host keeps a reservation as scroll-surface padding; mirroring that here
// is what lets the widget's own observation run against the mock.
function overlayPadding(side: 'left' | 'right'): 'paddingLeft' | 'paddingRight' {
  return side === 'left' ? 'paddingLeft' : 'paddingRight'
}

function findWidgetElement(context: EditorViewContributionContext): HTMLElement {
  const widget = context.container.querySelector<HTMLElement>('.editor-find-widget')
  if (!widget) throw new Error('missing find widget')
  return widget
}

function pluginContext(): EditorPluginContext {
  return createTestPluginContext({
    registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
    registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerViewContribution: vi.fn<EditorPluginContext['registerViewContribution']>(
      (_provider: EditorViewContributionProvider) => ({ dispose: vi.fn() }),
    ),
    registerCommandContribution: vi.fn<EditorPluginContext['registerCommandContribution']>(
      (_provider: EditorCommandContributionProvider) => ({ dispose: vi.fn() }),
    ),
    registerCapabilityContribution: vi.fn<EditorPluginContext['registerCapabilityContribution']>(
      (_provider: EditorCapabilityContributionProvider) => ({ dispose: vi.fn() }),
    ),
    registerEditContribution: vi.fn<EditorPluginContext['registerEditContribution']>(
      (_provider: EditorEditContributionProvider) => ({ dispose: vi.fn() }),
    ),
    registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
  })
}

function viewContext(viewSnapshot = snapshot()): EditorViewContributionContext & {
  readonly widthListeners: Set<(side: EditorOverlaySide) => void>
} {
  const container = document.createElement('div')
  const scrollElement = document.createElement('div')
  container.appendChild(scrollElement)
  const widthListeners = new Set<(side: EditorOverlaySide) => void>()
  const context = createTestViewContributionContext({
    container,
    scrollElement,
    contentElement: scrollElement,
    highlightPrefix: 'editor-find-test',
    getSnapshot: () => viewSnapshot,
    reserveOverlayWidth: vi.fn<EditorViewContributionContext['reserveOverlayWidth']>(
      (side, width) => {
        scrollElement.style[overlayPadding(side)] = width > 0 ? `${Math.ceil(width)}px` : ''
        for (const listener of [...widthListeners]) listener(side)
      },
    ),
    getReservedOverlayWidth: (side) =>
      Number.parseFloat(scrollElement.style[overlayPadding(side)]) || 0,
    onDidChangeReservedOverlayWidth: (listener) => {
      widthListeners.add(listener)
      return { dispose: () => widthListeners.delete(listener) }
    },
  })
  return Object.assign(context, { widthListeners })
}

function snapshot(): EditorViewSnapshot {
  return {
    documentId: 'find-test',
    languageId: null,
    ...createTestViewSnapshotSource('foo bar foo'),
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
    lineStarts: [0],
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [
      { anchorOffset: 0, headOffset: 0, startOffset: 0, endOffset: 0, affinity: 'after' },
    ],
    metrics: { rowHeight: 20, characterWidth: 8 },
    lineCount: 1,
    contentWidth: 88,
    totalHeight: 20,
    gutterWidth: 0,
    gutterLayout: { leadingInset: 0, fixedWidth: 0, lanes: [] },
    tabSize: 2,
    foldMarkers: [],
    visibleRows: [],
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 20,
      scrollWidth: 88,
      clientHeight: 20,
      clientWidth: 88,
      visibleRange: { start: 0, end: 1 },
    },
    toVisibleSnapshot() {
      return null
    },
  }
}
