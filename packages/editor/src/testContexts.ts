import { createStringTextSnapshot, type TextReadSnapshot } from './documentTextSnapshot'
import { createError } from './logging/evlog'
import { LineStartsView } from './virtualization/lineStartIndex'
import type {
  EditorCapabilityContributionContext,
  EditorDisposable,
  EditorEditContributionContext,
  EditorPluginContext,
  EditorLineStartsView,
  EditorInternalViewContributionContext,
  EditorViewSnapshot,
} from './plugins'

// The hand-written contexts every test double is built from. Each default object is typed as the
// whole context, so a member added to a context fails to compile here instead of in every test.

const noDisposal: EditorDisposable = { dispose: () => undefined }

function missing(member: string): never {
  throw createError({
    code: 'EDITOR_TEST_CONTEXT_MISSING',
    message: `This test context was created without ${member}`,
    fix: `Pass ${member} to the test context factory.`,
  })
}

export function createTestPluginContext(
  overrides: Partial<EditorPluginContext> = {},
): EditorPluginContext {
  const defaults: EditorPluginContext = {
    log: () => undefined,
    registerLogger: () => noDisposal,
    registerHighlighter: () => noDisposal,
    registerSyntaxProvider: () => noDisposal,
    registerViewContribution: () => noDisposal,
    registerCommandContribution: () => noDisposal,
    registerCapabilityContribution: () => noDisposal,
    registerEditContribution: () => noDisposal,
    registerDecorationContribution: () => noDisposal,
    registerGutterContribution: () => noDisposal,
    registerInjectedTextRowProvider: () => noDisposal,
    registerInlineReplacementProvider: () => noDisposal,
    registerSelectionRangeProvider: () => noDisposal,
  }
  return { ...defaults, ...overrides }
}

export function createTestCapabilityContributionContext(
  overrides: Partial<EditorCapabilityContributionContext> = {},
): EditorCapabilityContributionContext {
  const defaults: EditorCapabilityContributionContext = {
    registerFeature: () => noDisposal,
    registerProvider: () => noDisposal,
  }
  return { ...defaults, ...overrides }
}

export function createTestEditContributionContext(
  overrides: Partial<EditorEditContributionContext> = {},
): EditorEditContributionContext {
  const defaults: EditorEditContributionContext = {
    ...createTestCapabilityContributionContext(),
    hasDocument: () => true,
    log: () => undefined,
    materializeFullText: () => missing('materializeFullText'),
    getTextSnapshot: () => null,
    getDocumentSyncPoint: () => missing('getDocumentSyncPoint'),
    changesSinceDocumentSyncPoint: () => null,
    getSelections: () => [],
    focusEditor: () => undefined,
    applyEdits: () => undefined,
    startSnippetSession: () => undefined,
  }
  return { ...defaults, ...overrides }
}

export function createTestViewContributionContext(
  overrides: Partial<EditorInternalViewContributionContext> = {},
): EditorInternalViewContributionContext {
  const ownerDocument = overrides.scrollElement?.ownerDocument ?? document
  const scrollElement = overrides.scrollElement ?? ownerDocument.createElement('div')
  const container = overrides.container ?? ownerDocument.createElement('div')
  if (!overrides.container && !overrides.scrollElement) container.appendChild(scrollElement)

  const defaults: EditorInternalViewContributionContext = {
    unstableEditor: null,
    getSelections: () => [],
    applyEdits: () => undefined,
    registerCommand: () => noDisposal,
    refreshInputs: () => undefined,
    container,
    scrollElement,
    contentElement: scrollElement,
    highlightPrefix: 'editor-test',
    hasDocument: () => true,
    getSnapshot: () => missing('getSnapshot'),
    requestViewUpdate: () => undefined,
    onDidType: () => noDisposal,
    registerPressParticipant: () => noDisposal,
    registerKeymapContextKey: () => noDisposal,
    registerNonCaretRows: () => noDisposal,
    getFeature: () => null,
    getProviders: () => [],
    registerProvider: () => noDisposal,
    log: () => undefined,
    revealLine: () => undefined,
    focusEditor: () => undefined,
    announce: () => undefined,
    setSelection: () => undefined,
    setSelections: () => undefined,
    setScrollPosition: () => undefined,
    reserveOverlayWidth: () => undefined,
    getReservedOverlayWidth: () => 0,
    onDidChangeReservedOverlayWidth: () => noDisposal,
    getRowPresentation: () => null,
    rowAtPoint: () => null,
    markerAtPoint: () => null,
    textOffsetFromPoint: () => null,
    getRangeClientRect: () => null,
    // Nothing edits a test double's document, so tracked spans stay where they were given.
    trackRanges: (ranges) => ({ resolve: () => ranges }),
    trackPoint: (anchor) => ({ resolve: () => ({ kind: 'live', offset: anchor.offset }) }),
    setRangeHighlight: () => undefined,
    clearRangeHighlight: () => undefined,
  }
  return { ...defaults, ...overrides }
}

/** The line queries a hand-built view snapshot carries, read off `source`. */
export function createTestLineStartsView(source: TextReadSnapshot): EditorLineStartsView {
  return new LineStartsView(source)
}

/** The two source fields every hand-built view snapshot needs, from one string. */
export function createTestViewSnapshotSource(
  text: string,
): Pick<EditorViewSnapshot, 'textSnapshot' | 'lineStartsView'> {
  const textSnapshot = createStringTextSnapshot(text)
  return { textSnapshot, lineStartsView: createTestLineStartsView(textSnapshot) }
}
