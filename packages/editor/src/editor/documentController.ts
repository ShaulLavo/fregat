import type { DocumentSession } from '../documentSession'
import {
  createStringTextSnapshot,
  type DocumentTextSnapshot,
  type TextSnapshot,
} from '../documentTextSnapshot'
import {
  createEditorDocumentSession,
  normalizeEditorDocumentMode,
  normalizeEditorEditability,
  type ResetOwnedDocumentOptions,
} from './editorDocument'
import type {
  EditorDocumentMode,
  EditorEditability,
  EditorOpenDocumentOptions,
  EditorSessionOptions,
} from './types'
import type { EditorSyntaxLanguageId } from '../syntax/session'

export type EditorDocumentControllerOptions = {
  readonly defaultDocumentMode?: EditorDocumentMode
  readonly defaultEditability?: EditorEditability
  readonly highlightPrefix: string
}

export type EditorDocumentAttachment = {
  readonly documentVersion: number
  readonly internalDocumentId: string
  readonly languageId: EditorSyntaxLanguageId | null
  readonly session: DocumentSession
  readonly textSnapshot: DocumentTextSnapshot
}

export class EditorDocumentController {
  private readonly defaultDocumentMode: EditorDocumentMode | undefined
  private readonly highlightPrefix: string
  private currentTextSnapshot: TextSnapshot = createStringTextSnapshot('')
  private currentSession: DocumentSession | null = null
  private currentSessionOptions: EditorSessionOptions = {}
  private currentDocumentId: string | null = null
  private currentDocumentMode: EditorDocumentMode
  private currentEditability: EditorEditability
  private currentLanguageId: EditorSyntaxLanguageId | null = null
  private currentDocumentVersion = 0
  private currentTextVersion = 0

  constructor(options: EditorDocumentControllerOptions) {
    this.defaultDocumentMode = options.defaultDocumentMode
    this.highlightPrefix = options.highlightPrefix
    this.currentDocumentMode = normalizeEditorDocumentMode(options.defaultDocumentMode)
    this.currentEditability = normalizeEditorEditability(options.defaultEditability)
  }

  get textSnapshot(): TextSnapshot {
    return this.currentTextSnapshot
  }

  get session(): DocumentSession | null {
    return this.currentSession
  }

  get sessionOptions(): EditorSessionOptions {
    return this.currentSessionOptions
  }

  get documentId(): string | null {
    return this.currentDocumentId
  }

  get documentMode(): EditorDocumentMode {
    return this.currentDocumentMode
  }

  get editability(): EditorEditability {
    return this.currentEditability
  }

  get languageId(): EditorSyntaxLanguageId | null {
    return this.currentLanguageId
  }

  get documentVersion(): number {
    return this.currentDocumentVersion
  }

  get textVersion(): number {
    return this.currentTextVersion
  }

  setRenderedTextSnapshot(textSnapshot: TextSnapshot): void {
    if (this.currentTextSnapshot === textSnapshot) return

    this.currentTextSnapshot = textSnapshot
    this.currentTextVersion += 1
  }

  setEditability(editability: EditorEditability): boolean {
    const next = normalizeEditorEditability(editability)
    if (this.currentEditability === next) return false

    this.currentEditability = next
    return true
  }

  canEditDocument(): boolean {
    return this.currentEditability === 'editable' && this.currentDocumentMode === 'session'
  }

  attachSession(
    session: DocumentSession,
    options: EditorSessionOptions = {},
  ): EditorDocumentAttachment {
    this.currentDocumentVersion += 1
    this.currentDocumentId = options.documentId ?? null
    this.currentDocumentMode = 'session'
    this.currentLanguageId = options.languageId ?? null
    this.currentSession = session
    this.currentSessionOptions = options
    this.setRenderedTextSnapshot(session.getTextSnapshot())

    return {
      documentVersion: this.currentDocumentVersion,
      internalDocumentId: this.currentSessionDocumentId(),
      languageId: this.currentLanguageId,
      session,
      textSnapshot: session.getTextSnapshot(),
    }
  }

  detachSession(): void {
    this.currentSession = null
    this.currentSessionOptions = {}
  }

  clear(): number {
    this.currentDocumentVersion += 1
    this.currentDocumentId = null
    this.currentDocumentMode = normalizeEditorDocumentMode(this.defaultDocumentMode)
    this.currentLanguageId = null
    this.setRenderedTextSnapshot(createStringTextSnapshot(''))
    this.detachSession()
    return this.currentDocumentVersion
  }

  resetOwnedDocument(
    document: EditorOpenDocumentOptions,
    options: ResetOwnedDocumentOptions,
  ): EditorDocumentAttachment {
    this.currentDocumentVersion += 1
    this.currentDocumentId =
      options.documentId ??
      (options.persistentIdentity ? this.generatedDocumentId(this.currentDocumentVersion) : null)
    this.currentDocumentMode = normalizeEditorDocumentMode(
      document.documentMode ?? this.defaultDocumentMode,
    )
    this.currentLanguageId = document.languageId ?? null
    this.currentSession = createEditorDocumentSession(document.text, this.currentDocumentMode)
    this.currentSessionOptions = {}
    this.setRenderedTextSnapshot(this.currentSession.getTextSnapshot())

    return {
      documentVersion: this.currentDocumentVersion,
      internalDocumentId: this.currentSessionDocumentId(),
      languageId: this.currentLanguageId,
      session: this.currentSession,
      textSnapshot: this.currentSession.getTextSnapshot(),
    }
  }

  currentSessionDocumentId(): string {
    return this.currentDocumentId ?? this.generatedOpenSessionId(this.currentDocumentVersion)
  }

  private generatedDocumentId(documentVersion: number): string {
    return `${this.highlightPrefix}-document-${documentVersion}`
  }

  private generatedOpenSessionId(documentVersion: number): string {
    return `${this.highlightPrefix}-open-${documentVersion}`
  }
}
