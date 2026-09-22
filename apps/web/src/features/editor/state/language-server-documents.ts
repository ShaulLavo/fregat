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
}

export class LanguageServerDocuments {
  private configurationGeneration = 0
  private readonly entries = new Map<string, RetainedDocument>()

  getOrCreate(
    key: string,
    buffer: EditorTextBuffer,
    configuration: string,
    create: () => LanguageServerDocumentEntry,
  ): LanguageServerDocumentEntry {
    const current = this.entries.get(key)
    if (
      current?.buffer === buffer &&
      current.configuration === configuration &&
      current.document.lanes.every((lane) => lane.status !== 'error')
    )
      return current
    current?.document.dispose()
    const entry = { ...create(), buffer, configuration }
    this.entries.set(key, entry)
    return entry
  }

  configure(generation: number): void {
    if (generation === this.configurationGeneration) return
    this.dispose()
    this.configurationGeneration = generation
  }

  delete(key: string): void {
    this.entries.get(key)?.document.dispose()
    this.entries.delete(key)
  }

  retain(buffers: ReadonlyMap<string, EditorTextBuffer>): void {
    for (const [key, entry] of this.entries) {
      if (buffers.get(key) === entry.buffer) continue
      entry.document.dispose()
      this.entries.delete(key)
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.document.dispose()
    this.entries.clear()
  }
}
