import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { FileSyncService } from '@/features/editor/state/file-sync-service'
import {
  dirtySavableEditorDocuments,
  isDirtyLiveEditorDocument,
  isSavableEditorDocument,
} from '@/features/editor/utils/save'
import type { DocumentKey } from '@/lib/documents/utils/types'
import type { SettingsSyncService } from '@/features/settings/state/sync-service'

export class EditorSaveService {
  constructor(
    private readonly documentStore: EditorDocumentStoreApi,
    private readonly fileSync: FileSyncService,
    private readonly settingsSync: SettingsSyncService,
  ) {}

  async save(key: DocumentKey): Promise<boolean> {
    const state = this.documentStore.getState()
    const document = state.getLiveEditorDocument(key)
    if (!document || !isSavableEditorDocument(document)) return false
    if (!isDirtyLiveEditorDocument(state, key)) return true

    if (document.sync.kind === 'settings') {
      return this.settingsSync.save(document)
    }

    await this.fileSync.save(document)
    return true
  }

  async saveMany(
    keys: readonly DocumentKey[],
    onSaved?: (key: DocumentKey) => void,
  ): Promise<readonly boolean[]> {
    const results: boolean[] = []
    const failures: unknown[] = []

    // A failed document must not prevent later documents from reaching their owner.
    for (const key of keys) {
      try {
        results.push(await this.saveAndReport(key, onSaved))
      } catch (error) {
        results.push(false)
        failures.push(error)
      }
    }

    if (failures.length > 0) throw failures[0]
    return results
  }

  async saveAll(onSaved?: (key: DocumentKey) => void): Promise<void> {
    const keys = dirtySavableEditorDocuments(this.documentStore.getState()).map(
      (document) => document.key,
    )
    await this.saveMany(keys, onSaved)
  }

  private async saveAndReport(
    key: DocumentKey,
    onSaved?: (key: DocumentKey) => void,
  ): Promise<boolean> {
    const wasDirty = isDirtyLiveEditorDocument(this.documentStore.getState(), key)
    const saved = await this.save(key)
    if (saved && wasDirty) onSaved?.(key)
    return saved
  }
}
