import { MI_CODE_UNITS } from '@/features/editor/utils/large-file-policy'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import type { LanguageServerDocument } from '@singapore-editor/lsp-plugin'
import type { EditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import type { SemanticTokenController } from '@/features/editor/state/semantic-token-controller'

export type LanguageServerDocumentEntry = {
  readonly document: LanguageServerDocument
  readonly status: EditorLanguageServerStatusSource
  readonly semanticControllers: Map<string, Set<SemanticTokenController>>
}

type RetainedDocument = LanguageServerDocumentEntry & {
  readonly buffer: EditorTextBuffer
  readonly configuration: string
  readonly unsubscribe: () => void
}

export class LanguageServerDocuments {
  private configurationGeneration = 0
  private readonly entries = new Map<string, RetainedDocument>()

  private maxLength: number

  constructor(limitMiCodeUnits: number) {
    this.maxLength = limitMiCodeUnits * MI_CODE_UNITS
  }

  accepts(buffer: EditorTextBuffer): boolean {
    return buffer.getSnapshot().length <= this.maxLength
  }

  setLimit(limitMiCodeUnits: number): void {
    this.maxLength = limitMiCodeUnits * MI_CODE_UNITS
    for (const [key, entry] of this.entries) {
      if (!this.accepts(entry.buffer)) this.delete(key)
    }
  }

  getOrCreate(
    key: string,
    buffer: EditorTextBuffer,
    configuration: string,
    create: () => LanguageServerDocumentEntry,
  ): LanguageServerDocumentEntry | null {
    if (!this.accepts(buffer)) {
      this.delete(key)
      return null
    }
    const current = this.entries.get(key)
    if (
      current?.buffer === buffer &&
      current.configuration === configuration &&
      current.document.lanes.every((lane) => lane.status !== 'error')
    )
      return current
    this.delete(key)
    // Subscribe before the LSP document so a growth crossing closes it before didChange.
    const unsubscribe = buffer.subscribe(({ change }) => {
      if (change.textSnapshot.length > this.maxLength) this.delete(key)
    })
    try {
      const entry = { ...create(), buffer, configuration, unsubscribe }
      this.entries.set(key, entry)
      return entry
    } catch (error) {
      unsubscribe()
      throw error
    }
  }

  configure(generation: number): void {
    if (generation === this.configurationGeneration) return
    this.dispose()
    this.configurationGeneration = generation
  }

  delete(key: string): void {
    const entry = this.entries.get(key)
    entry?.unsubscribe()
    entry?.document.dispose()
    this.entries.delete(key)
  }

  retain(buffers: ReadonlyMap<string, EditorTextBuffer>): void {
    for (const [key, entry] of this.entries) {
      if (buffers.get(key) === entry.buffer) continue
      this.delete(key)
    }
  }

  dispose(): void {
    for (const key of this.entries.keys()) this.delete(key)
  }
}
