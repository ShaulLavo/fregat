import type { LanguageServerDocumentSnapshot } from './types'
import {
  type DocumentLogicalRevisionScope,
  type DocumentSyncPoint,
  type DocumentSyncSegment,
  type TextEdit,
} from '@singapore-editor/core/document'
import type {
  EditorContributionChange,
  EditorViewContributionUpdateKind,
} from '@singapore-editor/core/extensions'
import {
  recordLspPerformanceDiagnostic,
  type LspDocumentTransitionNotification,
  type LspTextDocumentSnapshot,
  type LspTextSnapshot,
  type LspWorkspaceDocumentAttachment,
  type LspWorkspace,
} from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import { projectDiagnosticsInSnapshot } from './diagnosticProjection'
import type { LanguageServerDocumentUriTransition } from './documentSyncController'
import { pathOrUriToDocumentUri } from './paths'
import type { ActiveDocument, DocumentDescriptor } from './pluginTypes'
import type { LanguageServerDocumentSyncOptions } from './types'
import { viewDocumentSnapshot } from './viewDocumentSnapshot'

/** `result` came from the server; `reset` is the client emptying the list itself. */
export type DocumentSyncSummaryKind = 'result' | 'reset'

export type DocumentSyncDiagnosticsPresenter = {
  clear(): void
  render(document: LspTextDocumentSnapshot, diagnostics: readonly lsp.Diagnostic[]): void
  publishSummary(
    uri: lsp.DocumentUri,
    version: number | null,
    diagnostics: readonly lsp.Diagnostic[],
    kind: DocumentSyncSummaryKind,
  ): void
}

export type DocumentSyncOptions = LanguageServerDocumentSyncOptions & {
  readonly logicalRevisionScope: DocumentLogicalRevisionScope
  onDocumentClosed(): void
}

export class DocumentSync {
  private attachment: LspWorkspaceDocumentAttachment | null = null
  private document: ActiveDocument | null = null
  private diagnosticItems: readonly lsp.Diagnostic[] = []
  private readonly logicalRevisionScope: DocumentLogicalRevisionScope
  private pendingUriProjection: PendingUriProjection | null = null
  private syncPoint: DocumentSyncPoint | null = null

  public constructor(
    private readonly workspace: LspWorkspace,
    private readonly presenter: DocumentSyncDiagnosticsPresenter,
    private readonly options: DocumentSyncOptions,
  ) {
    this.logicalRevisionScope = options.logicalRevisionScope
  }

  public get activeDocument(): ActiveDocument | null {
    return this.document
  }

  public get diagnostics(): readonly lsp.Diagnostic[] {
    return this.diagnosticItems
  }

  public shouldSync(
    kind: EditorViewContributionUpdateKind,
    snapshot: LanguageServerDocumentSnapshot,
  ): boolean {
    if (kind === 'document' || kind === 'content' || kind === 'clear') return true
    if (!this.document) return false
    return !sameSyncPoint(this.syncPoint, snapshot.documentSyncPoint)
  }

  public sync(
    snapshot: LanguageServerDocumentSnapshot,
    change: EditorContributionChange | null,
  ): void {
    const projectedUri = this.projectedDocumentUri(snapshot)
    const descriptor = documentDescriptor(snapshot, this.options, projectedUri)
    if (!descriptor) {
      this.detachDocument()
      return
    }

    this.openOrUpdateDocument(descriptor, change, snapshot)
  }

  public close(): void {
    this.pendingUriProjection = null
    this.detachDocument()
  }

  public transitionDocumentUri(
    snapshot: LanguageServerDocumentSnapshot,
    transition: LanguageServerDocumentUriTransition,
  ): boolean {
    if (!this.matchesTransitionSource(snapshot, transition)) return false

    const descriptor = documentDescriptor(
      snapshot,
      this.options,
      transition.toUri,
      transition.textSnapshot,
    )
    if (!descriptor) {
      this.detachDocument()
      this.pendingUriProjection = pendingUriProjection(transition)
      return true
    }

    this.transitionDocument(descriptor, transition.syncPoint)
    return true
  }

  private detachDocument(): void {
    const active = this.document
    const attachment = this.attachment
    this.attachment = null
    this.document = null
    this.diagnosticItems = []
    this.syncPoint = null
    this.options.onDocumentClosed()
    if (!active) return

    this.presenter.clear()
    if (attachment) this.workspace.closeDocument(attachment)
    this.presenter.publishSummary(active.uri, active.lspVersion, [], 'reset')
  }

  private matchesTransitionSource(
    snapshot: LanguageServerDocumentSnapshot,
    transition: LanguageServerDocumentUriTransition,
  ): boolean {
    const active = this.document
    const point = this.syncPoint
    if (!active || !this.attachment || !point) return false
    if (active.uri !== transition.fromUri) return false
    if (active.textSnapshot !== transition.textSnapshot) return false
    if (snapshot.textSnapshot !== transition.textSnapshot) return false
    if (point.revision !== transition.syncPoint.revision) return false
    if (point.textVersion !== transition.syncPoint.textVersion) return false
    return point.segment !== transition.syncPoint.segment
  }

  private projectedDocumentUri(
    snapshot: LanguageServerDocumentSnapshot,
  ): lsp.DocumentUri | undefined {
    const projection = this.pendingUriProjection
    if (!projection) return undefined
    if (snapshot.documentSyncPoint.segment !== projection.segment) {
      this.pendingUriProjection = null
      return undefined
    }
    const uri = documentUri(snapshot, this.options)
    if (uri === null) {
      this.pendingUriProjection = null
      return undefined
    }

    if (uri === projection.fromUri) return projection.toUri
    this.pendingUriProjection = null
    return undefined
  }

  public publishDiagnostics(params: unknown): void {
    const diagnostics = publishDiagnosticsParams(params)
    if (!diagnostics) return

    const active = this.document
    if (!active) return
    if (diagnostics.uri !== active.uri) return
    if (diagnostics.version !== null && diagnostics.version !== active.lspVersion) return

    this.replaceDiagnostics(active, diagnostics.version, diagnostics.diagnostics)
  }

  public pullDiagnostics(
    uri: lsp.DocumentUri,
    version: number,
    diagnostics: readonly lsp.Diagnostic[],
  ): void {
    const active = this.document
    if (!active || active.uri !== uri || active.lspVersion !== version) return

    this.replaceDiagnostics(active, version, diagnostics)
  }

  public clearDiagnostics(): void {
    const active = this.document
    this.diagnosticItems = []
    this.presenter.clear()
    if (!active) return

    this.presenter.publishSummary(active.uri, active.lspVersion, [], 'reset')
  }

  private openOrUpdateDocument(
    descriptor: DocumentDescriptor,
    change: EditorContributionChange | null,
    snapshot: LanguageServerDocumentSnapshot,
  ): void {
    const active = this.document
    if (!active) {
      this.openDocument(descriptor, snapshot.documentSyncPoint)
      return
    }

    if (active.uri !== descriptor.uri) {
      this.replaceOrTransitionDocument(descriptor, snapshot.documentSyncPoint)
      return
    }
    if (active.languageId !== descriptor.languageId) {
      this.openDocument(descriptor, snapshot.documentSyncPoint)
      return
    }
    if (sameSyncPoint(this.syncPoint, snapshot.documentSyncPoint)) return
    this.updateDocument(descriptor, change, snapshot)
  }

  private replaceDiagnostics(
    active: ActiveDocument,
    version: number | null,
    diagnostics: readonly lsp.Diagnostic[],
  ): void {
    this.diagnosticItems = diagnostics
    this.presenter.render(active, diagnostics)
    this.presenter.publishSummary(active.uri, version, diagnostics, 'result')
  }

  private openDocument(descriptor: DocumentDescriptor, syncPoint: DocumentSyncPoint): void {
    this.close()
    const result = this.workspace.openDocumentSnapshot({
      uri: descriptor.uri,
      languageId: descriptor.languageId,
      textSnapshot: descriptor.textSnapshot,
      lineStarts: descriptor.lineStarts,
      sourceRevision: syncPoint.revision,
      sourceSegment: syncPoint.segment,
      onDocumentTransition: (transition) => this.adoptDocumentTransition(transition),
    })
    this.attachment = result.attachment
    this.document = activeDocument(descriptor, result.document.version)
    this.syncPoint = syncPoint
  }

  private replaceOrTransitionDocument(
    descriptor: DocumentDescriptor,
    syncPoint: DocumentSyncPoint,
  ): void {
    if (!isSharedUriTransition(this.document, this.syncPoint, descriptor, syncPoint)) {
      this.openDocument(descriptor, syncPoint)
      return
    }
    this.transitionDocument(descriptor, syncPoint)
  }

  private transitionDocument(descriptor: DocumentDescriptor, syncPoint: DocumentSyncPoint): void {
    const attachment = this.attachment
    if (!attachment) throw new Error('An active LSP document must retain its workspace attachment.')

    const result = this.workspace.transitionDocumentUri(attachment, {
      uri: descriptor.uri,
      languageId: descriptor.languageId,
      textSnapshot: descriptor.textSnapshot,
      lineStarts: descriptor.lineStarts,
      sourceRevision: syncPoint.revision,
      sourceSegment: syncPoint.segment,
      sourceTextVersion: syncPoint.textVersion,
    })
    this.document = activeDocument(descriptor, result.document.version)
    this.syncPoint = syncPoint
  }

  private updateDocument(
    descriptor: DocumentDescriptor,
    change: EditorContributionChange | null,
    snapshot: LanguageServerDocumentSnapshot,
  ): void {
    const active = this.document
    const diagnostics = projectDiagnosticsInSnapshot(this.diagnosticItems, {
      previousDocument: active ?? descriptor,
      nextDocument: descriptor,
      change,
    })
    const changes = changesSinceLastSync(
      snapshot,
      this.syncPoint,
      this.logicalRevisionScope,
      change,
      active?.textSnapshot ?? descriptor.textSnapshot,
      descriptor.textSnapshot,
    )
    recordLspPerformanceDiagnostic('lsp.documentSync.editChain', {
      chained: changes.edits === null ? 'null' : changes.edits.length,
      logicalRevisionCount: changes.logicalRevisionCount,
      activeTextVersion: active?.textVersion ?? -1,
      snapshotTextVersion: snapshot.textVersion,
      changeEditCount: change?.edits.length ?? -1,
    })
    const document = this.synchronizeWorkspaceDocument(descriptor, changes)
    this.document = activeDocument(descriptor, document.version)
    this.syncPoint = changes.syncPointAfter
    if (diagnostics === this.diagnosticItems) return

    this.diagnosticItems = diagnostics
    this.presenter.render(descriptor, diagnostics)
  }

  private synchronizeWorkspaceDocument(
    descriptor: DocumentDescriptor,
    changes: SyncChanges,
  ): ReturnType<LspWorkspace['updateDocumentSnapshot']> {
    const source = {
      textSnapshot: descriptor.textSnapshot,
      lineStarts: descriptor.lineStarts,
      sourceRevision: changes.syncPointAfter.revision,
      sourceSegment: changes.syncPointAfter.segment,
    }
    if (changes.logicalRevisionCount === 0) {
      return this.workspace.adoptUnchangedDocumentSource(descriptor.uri, source)
    }

    return this.workspace.updateDocumentSnapshot(descriptor.uri, {
      ...source,
      edits: changes.edits,
      logicalRevisionCount: changes.logicalRevisionCount,
    })
  }

  private adoptDocumentTransition(transition: LspDocumentTransitionNotification): void {
    const active = this.document
    if (!active) return

    this.diagnosticItems = []
    this.presenter.clear()
    this.presenter.publishSummary(active.uri, active.lspVersion, [], 'reset')
    this.pendingUriProjection = {
      fromUri: active.uri,
      toUri: transition.document.uri,
      segment: transition.sourceSegment as DocumentSyncSegment,
    }
    this.document = activeDocumentForTransition(active, transition)
    this.syncPoint = {
      revision: transition.sourceRevision,
      segment: transition.sourceSegment as DocumentSyncSegment,
      textVersion: transition.sourceTextVersion,
    }
  }
}

type PendingUriProjection = {
  readonly fromUri: lsp.DocumentUri
  readonly toUri: lsp.DocumentUri
  readonly segment: DocumentSyncSegment
}

function pendingUriProjection(
  transition: LanguageServerDocumentUriTransition,
): PendingUriProjection {
  return {
    fromUri: transition.fromUri,
    toUri: transition.toUri,
    segment: transition.syncPoint.segment,
  }
}

type SyncChanges = {
  readonly edits: readonly TextEdit[] | null
  readonly logicalRevisionCount: number
  readonly syncPointAfter: DocumentSyncPoint
}

function changesSinceLastSync(
  snapshot: LanguageServerDocumentSnapshot,
  point: DocumentSyncPoint | null,
  scope: DocumentLogicalRevisionScope,
  change: EditorContributionChange | null,
  previousTextSnapshot: LspTextSnapshot,
  nextTextSnapshot: LspTextSnapshot,
): SyncChanges {
  if (!point) {
    return fallbackSyncChanges(
      snapshot,
      null,
      change,
      scope,
      previousTextSnapshot,
      nextTextSnapshot,
    )
  }

  const changes = snapshot.changesSinceDocumentSyncPoint(point, scope)
  if (changes) {
    return {
      edits: changes.edits,
      logicalRevisionCount: changes.logicalRevisionCount,
      syncPointAfter: changes.syncPointAfter,
    }
  }
  return fallbackSyncChanges(snapshot, point, change, scope, previousTextSnapshot, nextTextSnapshot)
}

function fallbackSyncChanges(
  snapshot: LanguageServerDocumentSnapshot,
  point: DocumentSyncPoint | null,
  change: EditorContributionChange | null,
  scope: DocumentLogicalRevisionScope,
  previousTextSnapshot: LspTextSnapshot,
  nextTextSnapshot: LspTextSnapshot,
): SyncChanges {
  const nextPoint = snapshot.documentSyncPoint
  const textChanged =
    previousTextSnapshot !== nextTextSnapshot ||
    point === null ||
    point.textVersion !== nextPoint.textVersion
  return {
    edits: null,
    logicalRevisionCount: fallbackLogicalRevisionCount(
      change,
      scope,
      textChanged,
      point,
      nextPoint,
    ),
    syncPointAfter: nextPoint,
  }
}

function fallbackLogicalRevisionCount(
  change: EditorContributionChange | null,
  scope: DocumentLogicalRevisionScope,
  textChanged: boolean,
  point: DocumentSyncPoint | null,
  nextPoint: DocumentSyncPoint,
): number {
  if (change?.logicalRevisionScope === scope) return change.logicalRevisionCount
  if (!textChanged) return 0
  if (!point) return 1
  return Math.max(1, nextPoint.textVersion - point.textVersion)
}

function sameSyncPoint(left: DocumentSyncPoint | null, right: DocumentSyncPoint): boolean {
  if (!left) return false
  return (
    left.revision === right.revision &&
    left.segment === right.segment &&
    left.textVersion === right.textVersion
  )
}

function isSharedUriTransition(
  active: ActiveDocument | null,
  currentPoint: DocumentSyncPoint | null,
  descriptor: DocumentDescriptor,
  nextPoint: DocumentSyncPoint,
): boolean {
  if (!active || !currentPoint) return false
  if (active.textSnapshot !== descriptor.textSnapshot) return false
  if (currentPoint.revision !== nextPoint.revision) return false
  if (currentPoint.textVersion !== nextPoint.textVersion) return false
  return currentPoint.segment !== nextPoint.segment
}

function activeDocument(descriptor: DocumentDescriptor, lspVersion: number): ActiveDocument {
  return {
    uri: descriptor.uri,
    languageId: descriptor.languageId,
    textSnapshot: descriptor.textSnapshot,
    lineStarts: descriptor.lineStarts,
    textVersion: descriptor.textVersion,
    lspVersion,
  }
}

function activeDocumentForTransition(
  active: ActiveDocument,
  transition: LspDocumentTransitionNotification,
): ActiveDocument {
  const document = transition.document
  return {
    uri: document.uri,
    languageId: document.languageId,
    textSnapshot: document.textSnapshot,
    lineStarts: document.lineStarts,
    textVersion: active.textVersion,
    lspVersion: document.version,
  }
}

function documentUri(
  snapshot: LanguageServerDocumentSnapshot,
  options: LanguageServerDocumentSyncOptions,
): lsp.DocumentUri | null {
  if (!snapshot.documentId) return null
  if (options.uriForDocument) return options.uriForDocument(snapshot)
  return pathOrUriToDocumentUri(snapshot.documentId)
}

function documentDescriptor(
  snapshot: LanguageServerDocumentSnapshot,
  options: LanguageServerDocumentSyncOptions,
  projectedUri?: lsp.DocumentUri,
  projectedTextSnapshot?: LspTextSnapshot,
): DocumentDescriptor | null {
  if (!snapshot.languageId) return null
  if (options.shouldSyncLanguageId?.(snapshot.languageId, snapshot) === false) return null

  const resolvedUri = documentUri(snapshot, options)
  if (resolvedUri === null) return null
  const uri = projectedUri ?? resolvedUri
  if (options.shouldSyncUri?.(uri, snapshot) === false) return null

  const document = viewDocumentSnapshot(snapshot)
  return {
    uri,
    // `shouldSyncLanguageId` above still filters on the view's id, not this one.
    languageId: options.languageIdForDocument?.(snapshot.languageId, uri) ?? snapshot.languageId,
    textSnapshot: projectedTextSnapshot ?? document.textSnapshot,
    lineStarts: document.lineStarts,
    textVersion: snapshot.textVersion,
  }
}

export function activeDocumentForSnapshot(
  snapshot: LanguageServerDocumentSnapshot,
  options: LanguageServerDocumentSyncOptions,
): ActiveDocument | null {
  const descriptor = documentDescriptor(snapshot, options)
  return descriptor ? activeDocument(descriptor, 0) : null
}

function publishDiagnosticsParams(params: unknown): {
  readonly uri: lsp.DocumentUri
  readonly version: number | null
  readonly diagnostics: readonly lsp.Diagnostic[]
} | null {
  if (!isRecord(params)) return null
  if (typeof params.uri !== 'string') return null
  if (!Array.isArray(params.diagnostics)) return null

  return {
    uri: params.uri,
    version: typeof params.version === 'number' ? params.version : null,
    diagnostics: params.diagnostics as lsp.Diagnostic[],
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
