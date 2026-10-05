import type {
  EditorTextBuffer,
  DocumentLogicalRevisionScope,
  DocumentSyncPoint,
  TextEdit,
} from '@singapore-editor/core/document'
import type { EditorDocumentContributions, EditorAnalysisRead } from '@singapore-editor/core/editor'
import {
  acquireEditorDocumentAnalysis,
  defineDocumentOperation,
  type DocumentOperationContext,
  type DocumentProjectionConnection,
  type DocumentProjectionReceipt,
  type DocumentProjectionUpdate,
} from '@singapore-editor/core/internal/document-worker'
import type {
  LspDocument,
  LspPreparedDocumentSource,
  LspWorkspace,
  LspWorkspaceDocumentAttachment,
} from '@singapore-editor/lsp'

type ProtocolInput = {
  readonly workspace: LspWorkspace
  readonly uri: string
  readonly languageId: string
  readonly logicalRevisionScope: DocumentLogicalRevisionScope
  readonly connection: LanguageServerSourceConnection
}

export type LanguageServerSourceOwner =
  | { readonly buffer: EditorTextBuffer; readonly documentId?: string }
  | { readonly contributions: EditorDocumentContributions }

export type LanguageServerSourcePublication = {
  readonly runtimeSessionId: string
  readonly document: LspDocument | null
  readonly previousDocument: LspDocument | null
  readonly point: DocumentSyncPoint | null
  readonly edits: readonly TextEdit[] | null
}

type Observer = {
  readonly deliver: (publication: LanguageServerSourcePublication) => void
  readonly onError: (error: unknown) => void
}
const observers = new WeakMap<LspWorkspace, Set<Observer>>()

export function observeLanguageServerSource(workspace: LspWorkspace, observer: Observer) {
  const current = observers.get(workspace) ?? new Set<Observer>()
  current.add(observer)
  observers.set(workspace, current)
  return () => {
    current.delete(observer)
    if (current.size === 0) observers.delete(workspace)
  }
}

function publishSource(workspace: LspWorkspace, publication: LanguageServerSourcePublication) {
  for (const observer of observers.get(workspace) ?? []) {
    try {
      observer.deliver(publication)
    } catch (error) {
      observer.onError(error)
    }
  }
}

export type LanguageServerSourceConnection = {
  readonly generation: number
  readonly ready: Promise<void>
  isCurrent(): boolean
}

const protocolOperation = defineDocumentOperation(
  (context, input: ProtocolInput) => new ProtocolSource(context, input),
  (left, right) =>
    left.workspace === right.workspace &&
    left.uri === right.uri &&
    left.languageId === right.languageId &&
    left.logicalRevisionScope === right.logicalRevisionScope &&
    left.connection === right.connection,
  { scheduling: 'ordered' },
)

export function retainLanguageServerSource(options: ProtocolInput & LanguageServerSourceOwner) {
  const owner = sourceOwner(options)
  const lease = owner.contributions.retain(protocolOperation, options)
  if (!lease) {
    owner.dispose()
    return null
  }
  const unregister = options.workspace.registerDocumentSource({
    uri: options.uri,
    runtimeSessionId: lease.runtimeSessionId,
    prepare: () => {
      const document = acceptedDocument(lease.read(), options)
      if (document) return preparedSource(document, lease, options)
      return lease.request().then((accepted) => {
        if (!accepted) throw new DOMException('Language-server source was retired', 'AbortError')
        return preparedSource(accepted, lease, options)
      })
    },
  })
  let disposed = false
  return {
    runtimeSessionId: lease.runtimeSessionId,
    current() {
      return disposed ? null : acceptedDocument(lease.read(), options)
    },
    request: () => lease.request(),
    dispose() {
      if (disposed) return
      disposed = true
      try {
        unregister()
        lease.dispose()
      } finally {
        owner.dispose()
      }
    },
  }
}

function acceptedDocument(
  state: EditorAnalysisRead<LspDocument | null>,
  options: ProtocolInput,
): LspDocument | null {
  if (!options.connection.isCurrent() || state.kind !== 'ready' || !state.result) return null
  const document = options.workspace.getDocument(options.uri)
  if (
    document?.version !== state.result.version ||
    document.textSnapshot !== state.result.textSnapshot
  )
    return null
  if (
    document.sourceRevision !== state.result.sourceRevision ||
    document.sourceSegment !== state.result.sourceSegment
  )
    return null
  return state.result
}

function preparedSource(
  document: LspDocument,
  lease: { read(): EditorAnalysisRead<LspDocument | null> },
  options: ProtocolInput,
): LspPreparedDocumentSource {
  return {
    document,
    isCurrent: () => {
      const current = acceptedDocument(lease.read(), options)
      return (
        current !== null &&
        current.sourceRevision === document.sourceRevision &&
        current.sourceSegment === document.sourceSegment &&
        current.version === document.version &&
        current.textSnapshot === document.textSnapshot
      )
    },
  }
}

function sourceOwner(options: ProtocolInput & LanguageServerSourceOwner) {
  if ('contributions' in options) return { contributions: options.contributions, dispose() {} }
  const owner = acquireEditorDocumentAnalysis({
    buffer: options.buffer,
    documentId: options.documentId ?? options.uri,
  })
  return { contributions: owner.analysis.contributions, dispose: owner.dispose }
}

class ProtocolSource {
  readonly logicalRevisionScope: DocumentLogicalRevisionScope
  private readonly connection: DocumentProjectionConnection
  private nextRegistration = 0
  private attachment: LspWorkspaceDocumentAttachment | null = null
  private document: LspDocument | null = null
  private publication: LanguageServerSourcePublication | null = null

  public constructor(
    private readonly context: DocumentOperationContext,
    private readonly input: ProtocolInput,
  ) {
    this.logicalRevisionScope = input.logicalRevisionScope
    this.connection = {
      generation: input.connection.generation,
      nextRegistration: () => ++this.nextRegistration,
      admit: this.admit,
      release: () => this.close(),
    }
  }

  public async connect(): Promise<DocumentProjectionConnection> {
    await this.input.connection.ready
    this.assertCurrentConnection()
    return this.connection
  }

  public async analyze(read: DocumentProjectionUpdate['read']): Promise<LspDocument | null> {
    const receipt = await this.context.source.prepareProjection(this, read)
    if (receipt && this.publication) publishSource(this.input.workspace, this.publication)
    return receipt ? this.document : null
  }

  public dispose(): void {
    this.close()
  }

  private readonly admit = async (
    update: DocumentProjectionUpdate,
    signal: AbortSignal,
  ): Promise<DocumentProjectionReceipt> => {
    signal.throwIfAborted()
    this.assertCurrentConnection()
    const read = update.read.text
    const point = update.read.revision.point
    const previousDocument = this.document
    const snapshot = {
      textSnapshot: read,
      lineStarts: {
        length: read.lineCount,
        at: (line: number) =>
          line >= 0 && line < read.lineCount ? read.lineStart(line) : undefined,
        indexForOffset: (offset: number) => read.lineAt(offset),
        toArray: () => Array.from({ length: read.lineCount }, (_, line) => read.lineStart(line)),
      },
      sourceRevision: point.revision,
      sourceSegment: point.segment,
    }
    if (!this.attachment || !update.changes) {
      this.close()
      const opened = this.input.workspace.openDocumentSnapshot({
        ...snapshot,
        uri: this.input.uri,
        languageId: this.input.languageId,
      })
      this.attachment = opened.attachment
      this.document = opened.document
    } else if (update.changes.logicalRevisionCount === 0 && this.document) {
      this.document = this.input.workspace.adoptUnchangedDocumentSource(this.input.uri, {
        ...snapshot,
        textSnapshot: this.document.textSnapshot,
        lineStarts: this.document.lineStarts,
      })
    } else {
      this.document = this.input.workspace.updateDocumentSnapshot(this.input.uri, {
        ...snapshot,
        edits: update.changes.edits,
        logicalRevisionCount: update.changes.logicalRevisionCount,
      })
    }
    signal.throwIfAborted()
    this.assertCurrentConnection()
    this.publication = {
      runtimeSessionId: this.context.runtimeSessionId,
      document: this.document,
      previousDocument,
      point,
      edits: update.changes?.edits ?? null,
    }
    return {
      kind: 'delivered',
      identity: update.identity,
      base: update.base,
      target: update.target,
    }
  }

  private assertCurrentConnection(): void {
    if (this.input.connection.isCurrent()) return
    throw new DOMException('Language-server connection generation was retired', 'AbortError')
  }

  private close(): void {
    const attachment = this.attachment
    this.attachment = null
    this.document = null
    const previousDocument = this.publication?.document ?? null
    this.publication = null
    if (!attachment) return
    try {
      this.input.workspace.closeDocument(attachment)
    } finally {
      publishSource(this.input.workspace, {
        runtimeSessionId: this.context.runtimeSessionId,
        document: null,
        previousDocument,
        point: null,
        edits: null,
      })
    }
  }
}
