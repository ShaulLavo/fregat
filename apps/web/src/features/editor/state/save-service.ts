import type { MutationOptions, QueryClient } from '@tanstack/react-query'

import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { FileSyncService } from '@/features/editor/state/file-sync-service'
import type { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import { EDITOR_SAVE_SCOPE, editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { notifyMutationError } from '@/features/editor/utils/notify-mutation-error'
import {
  dirtySavableEditorDocuments,
  isDirtyLiveEditorDocument,
  isSavableEditorDocument,
} from '@/features/editor/utils/save'
import type { DocumentKey } from '@/lib/documents/utils/types'
import { runMutation } from '@/lib/mutations/run'
import type { SettingsSyncService } from '@/features/settings/state/sync-service'

export class EditorSaveService {
  constructor(
    private readonly documentStore: EditorDocumentStoreApi,
    private readonly queryClient: QueryClient,
    private readonly fileSync: FileSyncService,
    private readonly settingsSync: SettingsSyncService,
    private readonly workspaceEdits: WorkspaceEditService | null,
  ) {}

  save(key: DocumentKey): Promise<boolean> {
    return runMutation(this.queryClient, this.saveOptions(key), key)
  }

  async saveMany(keys: readonly DocumentKey[]): Promise<readonly boolean[]> {
    const results: boolean[] = []
    const failures: unknown[] = []

    for (const key of keys) {
      try {
        results.push(await this.save(key))
      } catch (error) {
        results.push(false)
        failures.push(error)
      }
    }

    if (failures.length > 0) throw failures[0]
    return results
  }

  async saveAll(): Promise<void> {
    const keys = dirtySavableEditorDocuments(this.documentStore.getState()).map(
      (document) => document.key,
    )
    await this.saveMany(keys)
  }

  private saveOptions(key: DocumentKey): MutationOptions<boolean, unknown, DocumentKey> {
    return {
      mutationFn: (key) => this.performSave(key),
      mutationKey: editorMutationKeys.save(key),
      onError: notifyMutationError,
      scope: { id: EDITOR_SAVE_SCOPE },
    }
  }

  private async performSave(key: DocumentKey): Promise<boolean> {
    const state = this.documentStore.getState()
    const document = state.getLiveEditorDocument(key)
    if (!document || !isSavableEditorDocument(document)) return false
    const orphaned = document.sync.kind === 'file' && document.sync.orphaned
    if (!orphaned && !isDirtyLiveEditorDocument(state, key)) return true

    if (document.sync.kind === 'settings') {
      return this.settingsSync.save(document)
    }

    const write = async () => {
      await this.fileSync.save(document)
      return true
    }
    if (!this.workspaceEdits || document.target.kind !== 'file') return write()

    return this.workspaceEdits.runWorkspaceMutation([document.target.resource.path], write)
  }
}
