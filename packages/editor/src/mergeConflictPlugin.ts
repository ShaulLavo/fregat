import type { TextReadSnapshot } from './documentTextSnapshot'
import {
  carryMergeConflicts,
  parseMergeConflicts,
  resolveMergeConflict,
  type MergeConflictRegion,
  type MergeConflictResolution,
} from './mergeConflicts'
import type {
  EditorContributionChange,
  EditorDisposable,
  EditorFeatureContribution,
  EditorFeatureContributionContext,
  EditorInjectedTextRow,
  EditorInternalPluginContext,
  EditorMinimapDecoration,
  EditorMinimapFeature,
  EditorPlugin,
  EditorResolvedSelection,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from './plugins'
import { createEditorCapabilityToken, EDITOR_MINIMAP_FEATURE } from './plugins'
import type { TextEdit } from './tokens'
import type { DocumentChangesSinceSyncPoint, DocumentSyncPoint } from './editor/editChain'
import type { VirtualizedTextRowDecoration } from './virtualization'
import type { EditorSetSelectionOptions } from './editor/selectionReveal'

export const EDITOR_MERGE_CONFLICT_FEATURE_ID = 'editor.mergeConflicts'

type MergeConflictNavigationDirection = 'next' | 'previous'

export type EditorMergeConflictFeature = {
  getConflicts(): readonly MergeConflictRegion[]
  resolveConflict(index: number, resolution: MergeConflictResolution): boolean
  resolveAllConflicts(resolution: MergeConflictResolution): boolean
  revealConflict(index: number): boolean
  navigateConflict(direction: MergeConflictNavigationDirection): boolean
}

export const EDITOR_MERGE_CONFLICT_FEATURE =
  createEditorCapabilityToken<EditorMergeConflictFeature>(EDITOR_MERGE_CONFLICT_FEATURE_ID)

export type EditorMergeConflictPluginOptions = {
  /** The action line above each conflict. Defaults to on. */
  readonly lens?: boolean
  /** Handles "Compare Changes"; without it the lens does not offer one. */
  readonly compare?: (conflict: MergeConflictRegion) => void
}

type MergeConflictHost = {
  getTextSnapshot(): TextReadSnapshot | null
  getDocumentSyncPoint(): DocumentSyncPoint
  changesSinceDocumentSyncPoint(
    point: DocumentSyncPoint,
    scope: null,
  ): DocumentChangesSinceSyncPoint | null
  focusEditor(): void
  getSelections(): readonly EditorResolvedSelection[]
  setSelection(
    anchor: number,
    head: number,
    timingName: string,
    options?: EditorSetSelectionOptions,
  ): void
  applyEdits(
    edits: readonly TextEdit[],
    timingName: string,
    selection?: { readonly anchor: number; readonly head: number },
  ): void
  setRowDecorations(
    sourceId: string,
    decorations: ReadonlyMap<number, VirtualizedTextRowDecoration>,
  ): void
  clearRowDecorations(sourceId: string): void
}

type ConflictListener = () => void

type MergeConflictSideAtSelection = 'ours' | 'theirs' | 'base' | 'splitter' | null

const ROW_DECORATION_SOURCE_ID = 'editor.mergeConflicts'
const LENS_ROW_ID_PREFIX = 'editor.mergeConflicts.lens:'
const LENS_ROW_CLASS = 'editor-merge-conflict-lens-row'
// The overview-ruler marks. Literals, not tokens: the minimap paints on a canvas in a worker with
// no element to resolve a custom property against.
const CURRENT_MINIMAP_COLOR = 'rgba(64, 200, 174, 0.5)'
const INCOMING_MINIMAP_COLOR = 'rgba(64, 166, 255, 0.5)'
const COMMON_MINIMAP_COLOR = 'rgba(96, 96, 96, 0.4)'

const CURRENT_HEADER_ROW: VirtualizedTextRowDecoration = {
  className: 'editor-merge-conflict-current-header',
}
const CURRENT_CONTENT_ROW: VirtualizedTextRowDecoration = {
  className: 'editor-merge-conflict-current-content',
}
const COMMON_HEADER_ROW: VirtualizedTextRowDecoration = {
  className: 'editor-merge-conflict-common-header',
}
const COMMON_CONTENT_ROW: VirtualizedTextRowDecoration = {
  className: 'editor-merge-conflict-common-content',
}
const SPLITTER_ROW: VirtualizedTextRowDecoration = {
  className: 'editor-merge-conflict-splitter',
}
const INCOMING_CONTENT_ROW: VirtualizedTextRowDecoration = {
  className: 'editor-merge-conflict-incoming-content',
}
const INCOMING_HEADER_ROW: VirtualizedTextRowDecoration = {
  className: 'editor-merge-conflict-incoming-header',
}

export function createMergeConflictPlugin(
  options: EditorMergeConflictPluginOptions = {},
): EditorPlugin {
  return {
    name: EDITOR_MERGE_CONFLICT_FEATURE_ID,
    activate(context) {
      // Per activation: one plugin object in two editors must not share a controller.
      let controller: EditorMergeConflictController | null = null
      const internalContext = context as EditorInternalPluginContext
      const disposables: EditorDisposable[] = [
        internalContext.registerEditorFeatureContribution({
          createContribution(contributionContext) {
            controller = new EditorMergeConflictController(featureHost(contributionContext))
            return createMergeConflictFeatureContribution(contributionContext, controller, options)
          },
        }),
        context.registerViewContribution({
          createContribution(contributionContext) {
            if (!controller) return null
            return new MergeConflictViewContribution(contributionContext, controller, options)
          },
        }),
      ]
      if (options.lens === false) return disposables

      disposables.push(
        context.registerInjectedTextRowProvider({
          getInjectedTextRows: (rowContext) =>
            controller ? lensRows(controller.conflictsForSource(rowContext.textSnapshot)) : [],
          onDidChangeInjectedTextRows: (listener) =>
            controller ? controller.subscribe(listener) : { dispose() {} },
        }),
      )
      return disposables
    },
  }
}

class EditorMergeConflictController {
  private readonly listeners = new Set<ConflictListener>()
  private conflicts: readonly MergeConflictRegion[] = []
  private signature = ''
  // Held for identity: the regions describe this revision and no other.
  private parsedSource: TextReadSnapshot | null = null
  private parsedPoint: DocumentSyncPoint | null = null

  public constructor(private readonly host: MergeConflictHost) {}

  public dispose(): void {
    this.host.clearRowDecorations(ROW_DECORATION_SOURCE_ID)
    this.listeners.clear()
  }

  public subscribe(listener: ConflictListener): EditorDisposable {
    this.listeners.add(listener)
    return {
      dispose: () => this.listeners.delete(listener),
    }
  }

  public handleEditorChange(change: EditorContributionChange | null): void {
    if (!change) return
    if (change.kind === 'selection' || change.kind === 'synchronize' || change.kind === 'none') {
      return
    }

    this.refresh()
  }

  public getConflicts(): readonly MergeConflictRegion[] {
    this.refresh()
    return this.conflicts
  }

  public peekConflicts(): readonly MergeConflictRegion[] {
    return this.conflicts
  }

  /** The injected-row provider is handed the source it lays out; parse that, not a stale read. */
  public conflictsForSource(source: TextReadSnapshot): readonly MergeConflictRegion[] {
    if (source === this.parsedSource) return this.conflicts
    if (this.carryConflicts(source)) return this.conflicts

    const current = source === this.host.getTextSnapshot()
    const point = current ? this.host.getDocumentSyncPoint() : null
    this.setConflicts(parseMergeConflicts(source), source, point)
    return this.conflicts
  }

  public activateFromSnapshot(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
  ): void {
    if (kind === 'document' || kind === 'clear') this.setConflicts([], null, null)
    if (this.conflicts.length > 0) return
    if (!snapshotMayContainMergeConflict(snapshot)) return

    this.refresh()
  }

  public resolveConflict(index: number, resolution: MergeConflictResolution): boolean {
    const source = this.refresh()
    const conflict = this.conflicts[index]
    if (!source || !conflict) return false

    const resolved = resolveMergeConflict(source, conflict, resolution)
    if (!resolved) return false

    this.host.applyEdits(
      [
        {
          from: resolved.range.start,
          to: resolved.range.end,
          text: resolved.replacement,
        },
      ],
      'input.resolveMergeConflict',
      {
        anchor: resolved.selection.start,
        head: resolved.selection.end,
      },
    )
    return true
  }

  public resolveAllConflicts(resolution: MergeConflictResolution): boolean {
    const source = this.refresh()
    if (!source) return false

    const edits: TextEdit[] = []
    for (const conflict of this.conflicts) {
      const resolved = resolveMergeConflict(source, conflict, resolution)
      if (!resolved) continue
      edits.push({
        from: resolved.range.start,
        to: resolved.range.end,
        text: resolved.replacement,
      })
    }
    if (edits.length === 0) return false

    this.host.applyEdits(edits, 'input.resolveAllMergeConflicts')
    return true
  }

  public resolveConflictAtSelection(resolution: MergeConflictResolution): boolean {
    const conflict = this.conflictAtSelection()
    if (!conflict) return false

    return this.resolveConflict(conflict.index, resolution)
  }

  /** Whichever side the caret sits in; a caret on the splitter or in the base block resolves nothing. */
  public resolveSelectedSide(): boolean {
    const conflict = this.conflictAtSelection()
    if (!conflict) return false

    const side = sideAtOffset(conflict, this.headOffset())
    if (side !== 'ours' && side !== 'theirs') return false

    return this.resolveConflict(conflict.index, side)
  }

  public revealConflict(index: number): boolean {
    this.refresh()
    const conflict = this.conflicts[index]
    if (!conflict) return false

    this.host.setSelection(
      conflict.range.start,
      conflict.range.start,
      'input.revealMergeConflict',
      { revealOffset: conflict.range.start },
    )
    this.host.focusEditor()
    return true
  }

  public navigateConflict(direction: MergeConflictNavigationDirection): boolean {
    this.refresh()
    const target = conflictForNavigation(this.conflicts, this.headOffset(), direction)
    if (!target) return false

    return this.revealConflict(target.index)
  }

  public conflictAtSelection(): MergeConflictRegion | null {
    this.refresh()
    const offset = this.headOffset()
    return this.conflicts.find((conflict) => conflictContainsOffset(conflict, offset)) ?? null
  }

  private headOffset(): number {
    return this.host.getSelections()[0]?.headOffset ?? 0
  }

  private refresh(): TextReadSnapshot | null {
    const source = this.host.getTextSnapshot()
    if (!source) {
      this.setConflicts([], null, null)
      return null
    }

    this.conflictsForSource(source)
    return source
  }

  /** Every edit since the last scan counts, including ones delivered coalesced. */
  private carryConflicts(source: TextReadSnapshot): boolean {
    const previous = this.parsedSource
    if (!previous || !this.parsedPoint) return false
    if (source !== this.host.getTextSnapshot()) return false

    const changes = this.host.changesSinceDocumentSyncPoint(this.parsedPoint, null)
    const carried = changes?.edits ? carryMergeConflicts(previous, source, changes.edits) : null
    if (!changes || !carried) return false

    this.setConflicts(carried, source, changes.syncPointAfter)
    return true
  }

  private setConflicts(
    conflicts: readonly MergeConflictRegion[],
    source: TextReadSnapshot | null,
    point: DocumentSyncPoint | null,
  ): void {
    this.parsedSource = source
    this.parsedPoint = point
    const signature = conflictSignature(conflicts)
    if (this.signature === signature) return

    this.conflicts = conflicts
    this.signature = signature
    this.host.setRowDecorations(ROW_DECORATION_SOURCE_ID, rowDecorations(conflicts))
    this.emitChange()
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * What the view adds on top of the row tints: VS Code's CodeLens line for a conflict, "Accept
 * Current Change | Accept Incoming Change | Accept Both Changes | Compare Changes", laid over the
 * empty row injected above the `<<<<<<<` marker, and the overview-ruler marks in the minimap.
 */
class MergeConflictViewContribution implements EditorViewContribution {
  // Lenses sit on the mounted rows; the caret changes none of them.
  readonly inputs = ['content', 'tokens', 'viewport', 'layout'] as const
  private readonly root: HTMLDivElement
  private readonly subscription: EditorDisposable
  private readonly minimap: EditorMinimapFeature | null
  private minimapConflicts: readonly MergeConflictRegion[] | null = null

  public constructor(
    private readonly context: EditorViewContributionContext,
    private readonly controller: EditorMergeConflictController,
    private readonly options: EditorMergeConflictPluginOptions,
  ) {
    const document = context.scrollElement.ownerDocument
    this.root = document.createElement('div')
    this.root.className = 'editor-merge-conflict-lens-layer'
    context.contentElement.appendChild(this.root)
    this.minimap = context.getFeature(EDITOR_MINIMAP_FEATURE)
    this.subscription = controller.subscribe(() => this.render(context.getSnapshot()))
    const snapshot = context.getSnapshot()
    this.controller.activateFromSnapshot(snapshot, 'document')
    this.render(snapshot)
  }

  public update(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    _change?: EditorContributionChange | null,
  ): void {
    this.controller.activateFromSnapshot(snapshot, kind)
    this.render(snapshot)
  }

  public dispose(): void {
    this.subscription.dispose()
    this.minimap?.clearDecorations(ROW_DECORATION_SOURCE_ID)
    this.root.remove()
  }

  private render(snapshot: EditorViewSnapshot): void {
    const conflicts = this.controller.peekConflicts()
    this.publishMinimap(conflicts)
    this.root.textContent = ''
    if (this.options.lens === false) return
    for (const row of snapshot.visibleRows) {
      const index = lensRowConflictIndex(row.injectedTextRowId)
      if (index === null) continue
      const conflict = conflicts[index]
      if (!conflict) continue
      this.root.appendChild(this.createLens(conflict, row.top))
    }
  }

  private publishMinimap(conflicts: readonly MergeConflictRegion[]): void {
    if (!this.minimap || conflicts === this.minimapConflicts) return
    this.minimapConflicts = conflicts
    this.minimap.setDecorations(ROW_DECORATION_SOURCE_ID, minimapBands(conflicts))
  }

  private createLens(conflict: MergeConflictRegion, top: number): HTMLDivElement {
    const document = this.root.ownerDocument
    const lens = document.createElement('div')
    lens.className = 'editor-merge-conflict-lens'
    lens.style.transform = `translate3d(0, ${Math.max(0, top)}px, 0)`
    const actions: HTMLElement[] = [
      this.createAction('Accept Current Change', () =>
        this.controller.resolveConflict(conflict.index, 'ours'),
      ),
      this.createAction('Accept Incoming Change', () =>
        this.controller.resolveConflict(conflict.index, 'theirs'),
      ),
      this.createAction('Accept Both Changes', () =>
        this.controller.resolveConflict(conflict.index, 'both'),
      ),
    ]
    const compare = this.options.compare
    if (compare) {
      actions.push(
        this.createAction('Compare Changes', () => {
          compare(conflict)
          return true
        }),
      )
    }
    actions.forEach((action, index) => {
      if (index > 0) lens.appendChild(this.createSeparator())
      lens.appendChild(action)
    })
    return lens
  }

  private createAction(label: string, run: () => boolean): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement('button')
    button.type = 'button'
    button.tabIndex = -1
    button.className = 'editor-merge-conflict-lens-action'
    button.textContent = label
    addLensActionListeners(button, () => {
      const handled = run()
      this.context.focusEditor()
      return handled
    })
    return button
  }

  private createSeparator(): HTMLSpanElement {
    const separator = this.root.ownerDocument.createElement('span')
    separator.className = 'editor-merge-conflict-lens-separator'
    separator.ariaHidden = 'true'
    separator.textContent = '|'
    return separator
  }
}

function createMergeConflictFeatureContribution(
  context: EditorFeatureContributionContext,
  controller: EditorMergeConflictController,
  options: EditorMergeConflictPluginOptions,
): EditorFeatureContribution {
  const feature: EditorMergeConflictFeature = {
    getConflicts: () => controller.getConflicts(),
    resolveConflict: (index, resolution) => controller.resolveConflict(index, resolution),
    resolveAllConflicts: (resolution) => controller.resolveAllConflicts(resolution),
    revealConflict: (index) => controller.revealConflict(index),
    navigateConflict: (direction) => controller.navigateConflict(direction),
  }
  const disposables: EditorDisposable[] = [
    context.registerFeature(EDITOR_MERGE_CONFLICT_FEATURE, feature),
    context.registerCommand('merge-conflict.accept.current', () =>
      controller.resolveConflictAtSelection('ours'),
    ),
    context.registerCommand('merge-conflict.accept.incoming', () =>
      controller.resolveConflictAtSelection('theirs'),
    ),
    context.registerCommand('merge-conflict.accept.both', () =>
      controller.resolveConflictAtSelection('both'),
    ),
    context.registerCommand('merge-conflict.accept.selection', () =>
      controller.resolveSelectedSide(),
    ),
    context.registerCommand('merge-conflict.accept.all-current', () =>
      controller.resolveAllConflicts('ours'),
    ),
    context.registerCommand('merge-conflict.accept.all-incoming', () =>
      controller.resolveAllConflicts('theirs'),
    ),
    context.registerCommand('merge-conflict.accept.all-both', () =>
      controller.resolveAllConflicts('both'),
    ),
    context.registerCommand('merge-conflict.next', () => controller.navigateConflict('next')),
    context.registerCommand('merge-conflict.previous', () =>
      controller.navigateConflict('previous'),
    ),
    context.registerCommand('merge-conflict.compare', () => {
      const conflict = options.compare ? controller.conflictAtSelection() : null
      if (!conflict) return false
      options.compare?.(conflict)
      return true
    }),
  ]

  return {
    handleEditorChange: (change) => controller.handleEditorChange(change),
    dispose() {
      for (const disposable of disposables) disposable.dispose()
      controller.dispose()
    },
  }
}

function featureHost(context: EditorFeatureContributionContext): MergeConflictHost {
  return {
    getTextSnapshot: () => context.getTextSnapshot(),
    getDocumentSyncPoint: () => context.getDocumentSyncPoint(),
    changesSinceDocumentSyncPoint: (point, scope) =>
      context.changesSinceDocumentSyncPoint(point, scope),
    focusEditor: () => context.focusEditor(),
    getSelections: () => context.getSelections(),
    setSelection: (anchor, head, timingName, options) =>
      context.setSelection(anchor, head, timingName, options),
    applyEdits: (edits, timingName, selection) => context.applyEdits(edits, timingName, selection),
    setRowDecorations: (sourceId, decorations) => context.setRowDecorations(sourceId, decorations),
    clearRowDecorations: (sourceId) => context.clearRowDecorations(sourceId),
  }
}

function lensRows(conflicts: readonly MergeConflictRegion[]): readonly EditorInjectedTextRow[] {
  return conflicts.map((conflict) => ({
    id: `${LENS_ROW_ID_PREFIX}${conflict.index}`,
    anchorBufferRow: conflict.startMarkerLine,
    placement: 'before',
    text: '',
    className: LENS_ROW_CLASS,
  }))
}

function minimapBands(
  conflicts: readonly MergeConflictRegion[],
): readonly EditorMinimapDecoration[] {
  return conflicts.flatMap((conflict) => {
    const currentEnd = conflict.baseMarkerLine ?? conflict.separatorMarkerLine
    const bands = [
      minimapBand(conflict.startMarkerLine, currentEnd, CURRENT_MINIMAP_COLOR),
      minimapBand(
        conflict.separatorMarkerLine + 1,
        conflict.endMarkerLine + 1,
        INCOMING_MINIMAP_COLOR,
      ),
    ]
    if (conflict.baseMarkerLine !== undefined) {
      bands.push(
        minimapBand(conflict.baseMarkerLine, conflict.separatorMarkerLine, COMMON_MINIMAP_COLOR),
      )
    }
    return bands
  })
}

/** Rows are zero-based and the end exclusive; the minimap counts lines from one, both ends inclusive. */
function minimapBand(
  startRow: number,
  endRowExclusive: number,
  color: string,
): EditorMinimapDecoration {
  return {
    startLineNumber: startRow + 1,
    startColumn: 1,
    endLineNumber: Math.max(startRow, endRowExclusive - 1) + 1,
    endColumn: 1,
    color,
    position: 'inline',
  }
}

function lensRowConflictIndex(injectedTextRowId: string | undefined): number | null {
  if (!injectedTextRowId?.startsWith(LENS_ROW_ID_PREFIX)) return null
  const index = Number(injectedTextRowId.slice(LENS_ROW_ID_PREFIX.length))
  return Number.isInteger(index) ? index : null
}

function rowDecorations(
  conflicts: readonly MergeConflictRegion[],
): ReadonlyMap<number, VirtualizedTextRowDecoration> {
  const decorations = new Map<number, VirtualizedTextRowDecoration>()
  for (const conflict of conflicts) addConflictRowDecorations(decorations, conflict)
  return decorations
}

function addConflictRowDecorations(
  decorations: Map<number, VirtualizedTextRowDecoration>,
  conflict: MergeConflictRegion,
): void {
  const currentEnd = conflict.baseMarkerLine ?? conflict.separatorMarkerLine
  decorations.set(conflict.startMarkerLine, CURRENT_HEADER_ROW)
  setRowRange(decorations, conflict.startMarkerLine + 1, currentEnd, CURRENT_CONTENT_ROW)
  if (conflict.baseMarkerLine !== undefined) {
    decorations.set(conflict.baseMarkerLine, COMMON_HEADER_ROW)
    setRowRange(
      decorations,
      conflict.baseMarkerLine + 1,
      conflict.separatorMarkerLine,
      COMMON_CONTENT_ROW,
    )
  }
  decorations.set(conflict.separatorMarkerLine, SPLITTER_ROW)
  setRowRange(
    decorations,
    conflict.separatorMarkerLine + 1,
    conflict.endMarkerLine,
    INCOMING_CONTENT_ROW,
  )
  decorations.set(conflict.endMarkerLine, INCOMING_HEADER_ROW)
}

function setRowRange(
  decorations: Map<number, VirtualizedTextRowDecoration>,
  start: number,
  endExclusive: number,
  decoration: VirtualizedTextRowDecoration,
): void {
  for (let row = start; row < endExclusive; row += 1) decorations.set(row, decoration)
}

function conflictContainsOffset(conflict: MergeConflictRegion, offset: number): boolean {
  return offset >= conflict.range.start && offset < conflict.range.end
}

function sideAtOffset(conflict: MergeConflictRegion, offset: number): MergeConflictSideAtSelection {
  const currentEnd = conflict.baseMarker ?? conflict.separatorMarker
  if (offset < currentEnd.start) return 'ours'
  if (offset >= conflict.separatorMarker.end) return 'theirs'
  if (offset < conflict.separatorMarker.start) return 'base'
  return 'splitter'
}

/** VS Code's order: the next conflict past the caret, wrapping to the far end; one conflict never moves. */
function conflictForNavigation(
  conflicts: readonly MergeConflictRegion[],
  offset: number,
  direction: MergeConflictNavigationDirection,
): MergeConflictRegion | null {
  if (conflicts.length === 0) return null
  if (conflicts.length === 1) {
    return conflictContainsOffset(conflicts[0]!, offset) ? null : conflicts[0]!
  }

  const forwards = direction === 'next'
  const ordered = forwards ? conflicts : [...conflicts].reverse()
  const candidate = ordered.find((conflict) => {
    if (conflictContainsOffset(conflict, offset)) return false
    return forwards ? offset < conflict.range.start : offset > conflict.range.start
  })
  return candidate ?? ordered[0]!
}

function conflictSignature(conflicts: readonly MergeConflictRegion[]): string {
  return conflicts
    .map((conflict) =>
      [
        conflict.range.start,
        conflict.range.end,
        conflict.ours.start,
        conflict.ours.end,
        conflict.base?.start ?? '',
        conflict.base?.end ?? '',
        conflict.theirs.start,
        conflict.theirs.end,
        conflict.startMarkerLine,
        conflict.baseMarkerLine ?? '',
        conflict.separatorMarkerLine,
        conflict.endMarkerLine,
        conflict.oursLabel,
        conflict.baseLabel ?? '',
        conflict.theirsLabel,
      ].join(':'),
    )
    .join('|')
}

function snapshotMayContainMergeConflict(snapshot: EditorViewSnapshot): boolean {
  return snapshot.visibleRows.some((row) => lineStartsWithMergeConflictMarker(row.text.slice(0, 8)))
}

function lineStartsWithMergeConflictMarker(text: string): boolean {
  if (text.startsWith('<<<<<<<')) return true
  if (text.startsWith('|||||||')) return true
  if (text.startsWith('=======')) return true
  return text.startsWith('>>>>>>>')
}

/** Pointer-down runs the action and swallows the press so the editor never sees a click on its row. */
function addLensActionListeners(button: HTMLButtonElement, run: () => boolean): void {
  let handledPointerDown = false

  button.addEventListener('pointerdown', (event) => {
    handledPointerDown = true
    consumeLensEvent(event)
    run()
  })
  button.addEventListener('click', (event) => {
    consumeLensEvent(event)
    if (handledPointerDown) {
      handledPointerDown = false
      return
    }

    run()
  })
}

function consumeLensEvent(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}
