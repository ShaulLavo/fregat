import type { LanguageServerDocumentSnapshot, LanguageServerDocumentSyncOptions } from './types'
import type {
  DocumentLogicalRevisionScope,
  DocumentSyncSegment,
} from '@singapore-editor/core/document'
import type { EditorViewContributionUpdateKind } from '@singapore-editor/core/extensions'
import type { LspTextDocumentSnapshot, LspWorkspace } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'
import { projectDiagnosticsInSnapshot } from './diagnosticProjection'
import type { LanguageServerDocumentUriTransition } from './documentSyncController'
import { pathOrUriToDocumentUri } from './paths'
import type { ActiveDocument, DocumentDescriptor } from './pluginTypes'
import { viewDocumentSnapshot } from './viewDocumentSnapshot'
import {
  observeLanguageServerSource,
  retainLanguageServerSource,
  type LanguageServerSourceConnection,
  type LanguageServerSourceOwner,
  type LanguageServerSourcePublication,
} from './retainedSource'

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
  getSourceOwner(): LanguageServerSourceOwner | null
  getConnection(): LanguageServerSourceConnection | null
  onDocumentClosed(): void
  onDocumentChanged(): void
  onError(error: unknown): void
}
type SourceLease = NonNullable<ReturnType<typeof retainLanguageServerSource>>
type Binding = {
  readonly source: LanguageServerSourceOwner
  readonly connection: LanguageServerSourceConnection
  readonly uri: string
  readonly languageId: string
  readonly lease: SourceLease
}
type UriProjection = {
  readonly fromUri: string
  readonly toUri: string
  readonly segment: DocumentSyncSegment
  readonly previousSegment: DocumentSyncSegment
}

export class DocumentSync {
  private binding: Binding | null = null
  private document: ActiveDocument | null = null
  private diagnosticItems: readonly lsp.Diagnostic[] = []
  private pendingUriProjection: UriProjection | null = null
  private readonly unsubscribe: () => void

  constructor(
    private readonly workspace: LspWorkspace,
    private readonly presenter: DocumentSyncDiagnosticsPresenter,
    private readonly options: DocumentSyncOptions,
  ) {
    this.unsubscribe = observeLanguageServerSource(workspace, {
      deliver: this.adoptPublication,
      onError: options.onError,
    })
  }
  get activeDocument(): ActiveDocument | null {
    return this.document
  }
  get diagnostics(): readonly lsp.Diagnostic[] {
    return this.diagnosticItems
  }

  shouldSync(
    kind: EditorViewContributionUpdateKind,
    snapshot: LanguageServerDocumentSnapshot,
  ): boolean {
    if (kind === 'document' || kind === 'content' || kind === 'clear') return true
    const descriptor = this.descriptor(snapshot)
    return (
      descriptor?.uri !== this.binding?.uri || descriptor?.languageId !== this.binding?.languageId
    )
  }

  async sync(snapshot: LanguageServerDocumentSnapshot): Promise<void> {
    const descriptor = this.descriptor(snapshot)
    const source = this.options.getSourceOwner()
    const connection = this.options.getConnection()
    if (!descriptor || !source || !connection) {
      this.detach()
      return
    }
    const binding = this.bind(source, connection, descriptor)
    await binding?.lease.request()
  }

  close(): void {
    this.pendingUriProjection = null
    this.detach()
  }
  dispose(): void {
    this.unsubscribe()
    this.close()
  }

  transitionDocumentUri(
    snapshot: LanguageServerDocumentSnapshot,
    transition: LanguageServerDocumentUriTransition,
  ): boolean {
    const active = this.document
    const binding = this.binding
    if (!active || !binding || active.uri !== transition.fromUri) return false
    if (active.sourceSegment !== transition.previousSyncPoint.segment) return false
    if (active.sourceRevision > transition.previousSyncPoint.revision) return false
    if (
      transition.previousSyncPoint.revision !== transition.syncPoint.revision ||
      transition.previousSyncPoint.textVersion !== transition.syncPoint.textVersion
    )
      return false
    if (transition.previousSyncPoint.segment === transition.syncPoint.segment) return false
    const descriptor = documentDescriptor(snapshot, this.options, transition.toUri)
    if (!descriptor) {
      this.close()
      return true
    }
    this.pendingUriProjection = {
      fromUri: documentUri(snapshot, this.options) ?? transition.fromUri,
      toUri: transition.toUri,
      segment: transition.syncPoint.segment,
      previousSegment: transition.previousSyncPoint.segment,
    }
    const source = this.options.getSourceOwner()
    const connection = this.options.getConnection()
    if (!source || !connection) {
      this.detach()
      return true
    }
    const next = this.bind(source, connection, descriptor)
    void next?.lease.request().catch(this.options.onError)
    return true
  }

  publishDiagnostics(params: unknown): void {
    const diagnostics = publishDiagnosticsParams(params)
    const active = this.document
    if (!diagnostics || !active || diagnostics.uri !== active.uri) return
    if (diagnostics.version !== null && diagnostics.version !== active.lspVersion) return
    this.replaceDiagnostics(active, diagnostics.version, diagnostics.diagnostics)
  }
  pullDiagnostics(
    uri: lsp.DocumentUri,
    version: number,
    diagnostics: readonly lsp.Diagnostic[],
  ): void {
    const active = this.document
    if (!active || active.uri !== uri || active.lspVersion !== version) return
    this.replaceDiagnostics(active, version, diagnostics)
  }
  clearDiagnostics(): void {
    const active = this.document
    this.diagnosticItems = []
    this.presenter.clear()
    if (active) this.presenter.publishSummary(active.uri, active.lspVersion, [], 'reset')
  }

  private descriptor(snapshot: LanguageServerDocumentSnapshot): DocumentDescriptor | null {
    const projection = this.pendingUriProjection
    const uri = documentUri(snapshot, this.options)
    if (
      projection &&
      uri === projection.fromUri &&
      (snapshot.documentSyncPoint.segment === projection.segment ||
        snapshot.documentSyncPoint.segment === projection.previousSegment)
    )
      return documentDescriptor(snapshot, this.options, projection.toUri)
    this.pendingUriProjection = null
    return documentDescriptor(snapshot, this.options)
  }
  private bind(
    source: LanguageServerSourceOwner,
    connection: LanguageServerSourceConnection,
    descriptor: DocumentDescriptor,
  ): Binding | null {
    const previous = this.binding
    if (
      previous &&
      sameOwner(previous.source, source) &&
      previous.connection === connection &&
      previous.uri === descriptor.uri &&
      previous.languageId === descriptor.languageId
    )
      return previous
    this.detach()
    const lease = retainLanguageServerSource({
      ...source,
      workspace: this.workspace,
      uri: descriptor.uri,
      languageId: descriptor.languageId,
      logicalRevisionScope: this.options.logicalRevisionScope,
      connection,
    })
    this.binding = lease
      ? { source, connection, uri: descriptor.uri, languageId: descriptor.languageId, lease }
      : null
    return this.binding
  }
  private detach(): void {
    const binding = this.binding
    this.binding = null
    try {
      binding?.lease.dispose()
    } finally {
      this.clearDocument()
    }
  }
  private clearDocument(): void {
    const active = this.document
    this.document = null
    this.diagnosticItems = []
    this.options.onDocumentClosed()
    this.presenter.clear()
    if (active) this.presenter.publishSummary(active.uri, active.lspVersion, [], 'reset')
  }
  private readonly adoptPublication = (publication: LanguageServerSourcePublication): void => {
    if (publication.runtimeSessionId !== this.binding?.lease.runtimeSessionId) return
    const next = publication.document
    if (!next) {
      this.clearDocument()
      return
    }
    const previous = this.document
    if (
      previous?.sourceRevision === next.sourceRevision &&
      previous.sourceSegment === next.sourceSegment &&
      previous.lspVersion === next.version
    )
      return
    if (previous && previous.textSnapshot !== next.textSnapshot) {
      this.diagnosticItems = projectDiagnosticsInSnapshot(this.diagnosticItems, {
        previousDocument: previous,
        nextDocument: next,
        change: publication.edits ? { edits: publication.edits } : null,
      })
    }
    this.document = {
      ...next,
      textVersion: publication.point?.textVersion ?? 0,
      lspVersion: next.version,
    }
    this.presenter.render(this.document, this.diagnosticItems)
    this.options.onDocumentChanged()
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
}

function sameOwner(left: LanguageServerSourceOwner, right: LanguageServerSourceOwner): boolean {
  if ('buffer' in left && 'buffer' in right) return left.buffer === right.buffer
  if ('contributions' in left && 'contributions' in right)
    return left.contributions === right.contributions
  return false
}

function activeDocument(descriptor: DocumentDescriptor, lspVersion: number): ActiveDocument {
  return {
    uri: descriptor.uri,
    languageId: descriptor.languageId,
    textSnapshot: descriptor.textSnapshot,
    lineStarts: descriptor.lineStarts,
    textVersion: descriptor.textVersion,
    lspVersion,
    sourceRevision: descriptor.sourceRevision,
    sourceSegment: descriptor.sourceSegment,
  }
}

function documentUri(
  snapshot: LanguageServerDocumentSnapshot,
  options: LanguageServerDocumentSyncOptions,
): lsp.DocumentUri | null {
  if (options.uriForDocument) return options.uriForDocument(snapshot)
  return snapshot.documentId ? pathOrUriToDocumentUri(snapshot.documentId) : null
}

function documentDescriptor(
  snapshot: LanguageServerDocumentSnapshot,
  options: LanguageServerDocumentSyncOptions,
  projectedUri?: lsp.DocumentUri,
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
    textSnapshot: document.textSnapshot,
    lineStarts: document.lineStarts,
    textVersion: snapshot.textVersion,
    sourceRevision: snapshot.documentSyncPoint.revision,
    sourceSegment: snapshot.documentSyncPoint.segment,
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
