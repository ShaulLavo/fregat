import { describe, expect, it, vi } from 'vitest'
import { snapshotText } from './factories/snapshotText'

import { createBracketMatchPlugin } from '../src/bracketMatchPlugin'
import type { EditorAnyCommandId as EditorCommandId } from '../src/editor/commandCatalog'
import type {
  EditorCommandContribution,
  EditorCommandContributionProvider,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '../src/plugins'
import {
  TEST_DOCUMENT_SYNC_POINT,
  unchangedChangesSinceDocumentSyncPoint,
} from './factories/documentSync'
import type { BracketInfo } from '../src/syntax/session'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import { createTestPluginContext, createTestViewContributionContext } from '../src/testContexts'

const TEXT = 'fn(a)'
const BRACKETS: BracketInfo[] = [
  { char: '(', depth: 1, index: 2 },
  { char: ')', depth: 1, index: 4 },
]

describe('createBracketMatchPlugin', () => {
  it('paints both brackets when the caret touches a pair', () => {
    const harness = activate()

    harness.update(snapshot({ caret: 3 }), 'selection')

    expect(harness.view.setRangeHighlight).toHaveBeenCalledWith(
      'test-bracket-match',
      [
        { end: 3, start: 2 },
        { end: 5, start: 4 },
      ],
      expect.objectContaining({ backgroundColor: expect.any(String) }),
    )
  })

  it('clears the highlight once the caret leaves the pair', () => {
    const harness = activate()

    harness.update(snapshot({ caret: 3 }), 'selection')
    harness.update(snapshot({ caret: 1 }), 'selection')

    expect(harness.view.clearRangeHighlight).toHaveBeenCalledWith('test-bracket-match')
  })

  it('repaints only when the matched pair changes', () => {
    const harness = activate()

    harness.update(snapshot({ caret: 3 }), 'selection')
    harness.update(snapshot({ caret: 5 }), 'selection')

    expect(harness.view.setRangeHighlight).toHaveBeenCalledTimes(1)
  })

  it('ignores updates that cannot change the match', () => {
    const harness = activate()

    harness.update(snapshot({ caret: 3 }), 'viewport')

    expect(harness.view.setRangeHighlight).not.toHaveBeenCalled()
  })

  it('paints nothing while the caret has a non-empty selection', () => {
    const harness = activate()

    harness.update(snapshot({ caret: 3, selectionStart: 0, selectionEnd: 3 }), 'selection')

    expect(harness.view.setRangeHighlight).not.toHaveBeenCalled()
  })

  it('paints nothing when the parse has produced no brackets', () => {
    const harness = activate()

    harness.update(snapshot({ brackets: [], caret: 3 }), 'selection')

    expect(harness.view.setRangeHighlight).not.toHaveBeenCalled()
  })

  it('clears the highlight when the view is cleared', () => {
    const harness = activate()

    harness.update(snapshot({ caret: 3 }), 'selection')
    // A cleared view has no parse left to pair against.
    harness.update(snapshot({ brackets: [], caret: 3 }), 'clear')

    expect(harness.view.clearRangeHighlight).toHaveBeenCalledWith('test-bracket-match')
  })

  it('clears the highlight on dispose', () => {
    const harness = activate()

    harness.update(snapshot({ caret: 3 }), 'selection')
    harness.contribution.dispose()

    expect(harness.view.clearRangeHighlight).toHaveBeenCalledWith('test-bracket-match')
  })

  it('jumps the caret past the matching bracket', () => {
    const harness = activate({ caret: 3 })

    expect(harness.runCommand('editor.action.jumpToBracket')).toBe(true)
    expect(harness.view.setSelection).toHaveBeenCalledWith(5, 5, 'editor.jumpToBracket', {
      revealOffset: 5,
    })
  })

  it('jumps within the editor whose command ran when one plugin object serves two editors', () => {
    const plugin = createBracketMatchPlugin()
    const first = activate({ caret: 3 }, plugin)
    const second = activate({ brackets: [], caret: 3 }, plugin)

    expect(first.runCommand('editor.action.jumpToBracket')).toBe(true)
    expect(first.view.setSelection).toHaveBeenCalledTimes(1)
    expect(second.view.setSelection).not.toHaveBeenCalled()
    expect(second.runCommand('editor.action.jumpToBracket')).toBe(false)
  })

  it('reports the jump as unhandled when there is no match', () => {
    const harness = activate({ caret: 1 })

    expect(harness.runCommand('editor.action.jumpToBracket')).toBe(false)
    expect(harness.view.setSelection).not.toHaveBeenCalled()
  })
})

type SnapshotOptions = {
  readonly brackets?: readonly BracketInfo[]
  readonly caret?: number
  readonly selectionEnd?: number
  readonly selectionStart?: number
}

function snapshot(options: SnapshotOptions = {}): EditorViewSnapshot {
  const caret = options.caret ?? 0
  return {
    changesSinceDocumentSyncPoint: unchangedChangesSinceDocumentSyncPoint,
    brackets: options.brackets ?? BRACKETS,
    contentWidth: 80,
    gutterWidth: 0,
    gutterLayout: { fixedWidth: 0, lanes: [] },
    documentId: 'bracket-test',
    documentSyncPoint: TEST_DOCUMENT_SYNC_POINT,
    foldMarkers: [],
    ...snapshotText(TEXT),
    languageId: 'typescript',
    initialHighlightStatus: 'painted',
    syntaxStatus: 'ready',
    paintLayers: [],
    lineCount: 1,
    lineStarts: [0],
    metrics: { characterWidth: 8, rowHeight: 20 },
    selections: [
      {
        anchorOffset: options.selectionStart ?? caret,
        endOffset: options.selectionEnd ?? caret,
        headOffset: caret,
        startOffset: options.selectionStart ?? caret,
        affinity: 'after',
      },
    ],
    tabSize: 2,
    textVersion: 1,
    tokens: EditorTokenStore.empty(),
    totalHeight: 20,
    viewport: {
      clientHeight: 20,
      clientWidth: 80,
      scrollHeight: 20,
      scrollLeft: 0,
      scrollRow: 0,
      scrollTop: 0,
      scrollWidth: 80,
      visibleRange: { end: 1, start: 0 },
    },
    visibleRows: [],
    toVisibleSnapshot() {
      return null
    },
  }
}

/**
 * Activates the plugin against a fake host and returns the pieces a test drives: the view
 * contribution (which owns painting) and the command table it registered.
 */
function activate(snapshotOptions: SnapshotOptions = {}, plugin = createBracketMatchPlugin()) {
  const commands = new Map<EditorCommandId, () => boolean>()
  const view = viewContext(() => snapshot(snapshotOptions), commands)
  let contribution: EditorViewContribution | null = null

  const context = createTestPluginContext({
    registerCapabilityContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerCommandContribution: vi.fn((provider: EditorCommandContributionProvider) => {
      const created: EditorCommandContribution | null = provider.createContribution({
        registerCommand: (command, handler) => {
          commands.set(command, () => handler({}))
          return { dispose: vi.fn() }
        },
      })
      return created ?? { dispose: vi.fn() }
    }),
    registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
    registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerSyntaxProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerViewContribution: vi.fn((provider) => {
      contribution = provider.createContribution(view)
      return { dispose: vi.fn() }
    }),
  })

  // Read through a function: the assignment happens inside registerViewContribution's callback,
  // which control-flow analysis in this body does not see, so an inline read still narrows to the
  // initial null.
  function requireContribution(): EditorViewContribution {
    if (!contribution) throw new Error('bracket match plugin registered no view contribution')
    return contribution
  }

  plugin.activate(context)
  const created = requireContribution()

  return {
    contribution: created,
    runCommand: (command: EditorCommandId) => commands.get(command)?.() ?? false,
    update: created.update.bind(created),
    view,
  }
}

function viewContext(
  getSnapshot: () => EditorViewSnapshot,
  commands: Map<EditorCommandId, () => boolean>,
): EditorViewContributionContext {
  const container = document.createElement('div')
  const scrollElement = document.createElement('div')
  container.appendChild(scrollElement)

  return createTestViewContributionContext({
    clearRangeHighlight: vi.fn(),
    container,
    getSnapshot,
    highlightPrefix: 'test',
    scrollElement: scrollElement as HTMLDivElement,
    contentElement: scrollElement,
    setRangeHighlight: vi.fn(),
    setSelection: vi.fn(),
    registerCommand: (command, handler) => {
      commands.set(command, () => handler({}))
      return { dispose: () => commands.delete(command) }
    },
  })
}
