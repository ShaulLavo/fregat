import type { HistoryNodeId } from '@singapore-editor/core/document'
import {
  createDiffRegionStore,
  type DiffFile,
  type DiffGutterSide,
  type DiffRegionStore,
  type DiffPlugin,
} from '@singapore-editor/diff'
import type { TabId } from '@/lib/documents/utils/types'
import type { Editor, EditorScrollPosition } from '@singapore-editor/core/editor'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { DiffPaneAnchors } from '@/features/editor/utils/diff-source-anchors'
import {
  diffAttachmentReferences,
  diffAttachmentRevision,
  diffAttachmentSubject,
  type DiffAttachment,
} from '@/lib/diff-attachment'

export type DiffScrollPosition = Required<EditorScrollPosition>

export type DiffPanePublication = {
  readonly attachment: DiffAttachment
  readonly side: DiffGutterSide
  readonly editor: Editor
  readonly documentId: string
  readonly textVersion: number
  readonly geometryCommitted: true
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly visibleRowCount: number
  readonly projectionLength: number
}

export type DiffPanePublicationEvent = {
  readonly kind: 'presented' | 'withdrawn'
  readonly publication: DiffPanePublication
}

export type DiffPanePublicationSink = (event: DiffPanePublicationEvent) => void

export type DiffInputClaim = {
  readonly buffer: WeakRef<EditorTextBuffer> | null
  readonly revision: string
  readonly references: readonly WeakRef<object>[]
}

type DiffViewClaim = DiffInputClaim & {
  readonly subject: string
  readonly anchors: DiffPaneAnchors
}

export type DiffPanePresentation = {
  plugin: DiffPlugin | null
  views: Map<string, DiffInputClaim & { readonly anchors: DiffPaneAnchors }>
  /** A reloaded view, applied once over the current place when its input next matches. */
  pendingRestore: DiffViewClaim | null
}

/** A diff view in plain data, so it survives a page reload. */
export type DiffViewRecord = {
  readonly expanded: readonly string[]
  readonly layout?: Record<string, number>
  readonly old: DiffPaneAnchors | null
  readonly new: DiffPaneAnchors | null
  readonly stacked: DiffPaneAnchors | null
}

export function diffInputClaim(attachment: DiffAttachment): DiffInputClaim {
  const subject = diffAttachmentSubject(attachment)
  return {
    buffer: subject.buffer ? new WeakRef(subject.buffer) : null,
    revision: diffAttachmentRevision(attachment),
    references: diffAttachmentReferences(attachment).map((reference) => new WeakRef(reference)),
  }
}

function claimsDiffInput(claim: DiffInputClaim, attachment: DiffAttachment): boolean {
  const subject = diffAttachmentSubject(attachment)
  const references = diffAttachmentReferences(attachment)
  return (
    claim.revision === diffAttachmentRevision(attachment) &&
    (claim.buffer?.deref() ?? null) === subject.buffer &&
    claim.references.length === references.length &&
    claim.references.every((reference, index) => reference.deref() === references[index])
  )
}

export function pendingDiffRestore(presentation: DiffPanePresentation, attachment: DiffAttachment) {
  const pending = presentation.pendingRestore
  return pending?.subject === diffAttachmentSubject(attachment).key &&
    claimsDiffInput(pending, attachment)
    ? pending
    : null
}

export function matchingDiffView(presentation: DiffPanePresentation, attachment: DiffAttachment) {
  const saved = presentation.views.get(diffAttachmentSubject(attachment).key)
  return saved && claimsDiffInput(saved, attachment) ? saved : null
}

export type HistoryPresentation = {
  focusedId: HistoryNodeId | null
  selectedIds: readonly HistoryNodeId[]
  barrierFocused: boolean
}

export class TabPresentation {
  readonly regions: DiffRegionStore = createDiffRegionStore()
  readonly diffPanes: Readonly<Record<DiffGutterSide, DiffPanePresentation>> = {
    old: { plugin: null, views: new Map(), pendingRestore: null },
    new: { plugin: null, views: new Map(), pendingRestore: null },
    stacked: { plugin: null, views: new Map(), pendingRestore: null },
  }
  readonly history: HistoryPresentation = {
    focusedId: null,
    selectedIds: [],
    barrierFocused: false,
  }
  diffLayout: Record<string, number> | undefined
  diffFile: DiffFile | null = null

  restoreDiffView(attachment: DiffAttachment, view: DiffViewRecord): void {
    this.regions.setFile(attachment.file)
    for (const key of view.expanded) {
      if (!this.regions.getExpandedRegions().has(key)) this.regions.toggleRegion(key)
    }
    this.diffLayout = view.layout
    const subject = diffAttachmentSubject(attachment).key
    for (const side of ['old', 'new', 'stacked'] as const) {
      const anchors = view[side]
      this.diffPanes[side].pendingRestore = anchors
        ? { ...diffInputClaim(attachment), subject, anchors }
        : null
    }
  }

  diffViewRecord(attachment: DiffAttachment): DiffViewRecord {
    const anchors = (side: DiffGutterSide) =>
      pendingDiffRestore(this.diffPanes[side], attachment)?.anchors ??
      matchingDiffView(this.diffPanes[side], attachment)?.anchors ??
      null
    return {
      expanded: [...this.regions.getExpandedRegions()],
      layout: this.diffLayout,
      old: anchors('old'),
      new: anchors('new'),
      stacked: anchors('stacked'),
    }
  }

  setDiffFile(file: DiffFile | null): void {
    this.diffFile = file
  }

  setDiffLayout(layout: Record<string, number>): void {
    this.diffLayout = layout
  }

  setBarrierFocused(focused: boolean): void {
    this.history.barrierFocused = focused
  }
}

export function createTabPresentation(): TabPresentation {
  return new TabPresentation()
}

export class TabPresentations {
  private readonly tabs = new Map<TabId, TabPresentation>()

  get(tabId: TabId): TabPresentation {
    const existing = this.tabs.get(tabId)
    if (existing) return existing
    const presentation = createTabPresentation()
    this.tabs.set(tabId, presentation)
    return presentation
  }

  retain(tabIds: ReadonlySet<TabId>): void {
    for (const tabId of this.tabs.keys()) {
      if (!tabIds.has(tabId)) this.tabs.delete(tabId)
    }
  }

  copy(fromTabId: TabId, toTabId: TabId): void {
    const source = this.tabs.get(fromTabId)
    if (!source || fromTabId === toTabId) return
    const target = createTabPresentation()
    target.diffFile = source.diffFile
    target.diffLayout = source.diffLayout
    target.regions.setFile(source.diffFile)
    for (const key of source.regions.getExpandedRegions()) target.regions.toggleRegion(key)
    for (const side of ['old', 'new', 'stacked'] as const) {
      target.diffPanes[side].views = new Map(source.diffPanes[side].views)
      target.diffPanes[side].pendingRestore = source.diffPanes[side].pendingRestore
    }
    Object.assign(target.history, source.history)
    this.tabs.set(toTabId, target)
  }
}
