import {
  errorStringField,
  type SettingsRawWriteResult,
  type SettingsSnapshot,
  type SettingsWriteTarget,
} from '@workspace/contracts'
import type { DocumentKey } from '@/lib/documents/utils/types'
import type { QueryClient } from '@tanstack/react-query'

import type {
  EditorDocumentStoreApi,
  LiveEditorDocument,
} from '@/features/editor/state/document-state'
import { clientInstanceId } from '@/lib/instance-id'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { Client } from '@/lib/client'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { observeClientOperation } from '@/lib/client-logging'

import { saveSettingsText } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import {
  admitSettingsRawResult,
  refreshConfirmedSettings,
} from '@/features/settings/state/snapshot-admission'

let fallbackRawWriteSequence = 0

/** Saves raw JSON with compare-and-swap; semantic controls never use this path. */
export class SettingsSyncService {
  private readonly client: Client

  constructor(
    private readonly documentStore: EditorDocumentStoreApi,
    private readonly queryClient: QueryClient,
  ) {
    this.client = clientForQueryClient(queryClient)
  }

  async save(document: LiveEditorDocument): Promise<boolean> {
    if (document.sync.kind !== 'settings' || document.target.kind !== 'settings-json') {
      throw createClientInvariantError(`Cannot save ${document.key} as settings text`)
    }
    const priorSyncState = document.sync.state
    return observeClientOperation(
      {
        ...clientLogContext(this.client),
        action: 'settings.buffer-save',
        area: 'settings',
        documentKey: document.key,
        priorSyncState,
        target: document.target.target,
      },
      () => (priorSyncState === 'conflict' ? Promise.resolve(false) : this.write(document, false)),
      (acknowledged) => this.summarizeSave(document.key, priorSyncState, acknowledged),
    )
  }

  private summarizeSave(
    documentKey: DocumentKey,
    priorSyncState: Extract<LiveEditorDocument['sync'], { readonly kind: 'settings' }>['state'],
    acknowledged: boolean,
  ) {
    const state = this.documentStore.getState()
    const current = state.getLiveEditorDocument(documentKey)
    const syncState = current?.sync.kind === 'settings' ? current.sync.state : null
    let outcome = acknowledged ? 'accepted' : 'not-current'
    if (!acknowledged && syncState === 'conflict') {
      outcome = priorSyncState === 'conflict' ? 'conflict' : 'stale'
    }
    return { acknowledged, dirty: state.dirtyDocumentKeys.has(documentKey), outcome, syncState }
  }

  async overwrite(document: LiveEditorDocument): Promise<void> {
    if (document.sync.kind !== 'settings' || document.target.kind !== 'settings-json') {
      throw createClientInvariantError(`Cannot overwrite ${document.key} as settings text`)
    }
    if (document.sync.state !== 'conflict') return
    if (document.sync.revision === null) return

    await this.write(document, true)
  }

  private async write(
    document: LiveEditorDocument,
    allowMatchingConflictCompletion: boolean,
  ): Promise<boolean> {
    if (document.sync.kind !== 'settings' || document.target.kind !== 'settings-json') return false
    assertEnvironmentWritable(originForQueryClient(this.queryClient))

    const sync = document.sync
    const target = document.target.target
    if (sync.revision === null) return false

    const baseRevision = sync.revision
    const posted = document.buffer.materializeFullText()
    const savedContentRevision = document.contentRevision
    let result: SettingsRawWriteResult
    const request = {
      baseRevision,
      target,
      text: posted,
      writeId: rawWriteId(),
    }
    try {
      result = await saveSettingsText(request, this.client)
    } catch (error) {
      if (errorStringField(error, 'code') !== 'settings.RAW_REVISION_STALE') throw error

      await this.enterConflict(document.key, target)
      return false
    }

    const admission = await admitSettingsRawResult(this.queryClient, result)
    if (admission.recoveryPending && admission.confirmation) {
      const confirmed = await admission.confirmation
      return this.finishAdmittedWrite(
        document,
        target,
        posted,
        savedContentRevision,
        baseRevision,
        allowMatchingConflictCompletion,
        result,
        confirmed.snapshot,
      )
    }

    return this.finishAdmittedWrite(
      document,
      target,
      posted,
      savedContentRevision,
      baseRevision,
      allowMatchingConflictCompletion,
      result,
      admission.snapshot,
    )
  }

  private finishAdmittedWrite(
    document: LiveEditorDocument,
    target: SettingsWriteTarget,
    posted: string,
    savedContentRevision: string,
    baseRevision: string,
    allowMatchingConflictCompletion: boolean,
    result: SettingsRawWriteResult,
    snapshot: SettingsSnapshot | undefined,
  ): boolean {
    if (!snapshot) return false

    const confirmedFile = snapshot.layers.find((layer) => layer.id === target)?.file
    const writtenFile = result.snapshot.layers.find((layer) => layer.id === target)?.file
    if (!confirmedFile || !writtenFile) return false
    if (confirmedFile.text !== writtenFile.text) {
      this.documentStore
        .getState()
        .markSettingsDocumentConflict(document.key, confirmedFile.text, confirmedFile.revision)
      return false
    }

    return this.finishWrite(
      document,
      posted,
      savedContentRevision,
      baseRevision,
      allowMatchingConflictCompletion,
      confirmedFile,
    )
  }

  private finishWrite(
    document: LiveEditorDocument,
    posted: string,
    savedContentRevision: string,
    baseRevision: string,
    allowMatchingConflictCompletion: boolean,
    written: { readonly revision: string; readonly text: string },
  ): boolean {
    const current = this.documentStore.getState().getLiveEditorDocument(document.key)
    if (current?.sync.kind === 'settings' && current.sync.state === 'conflict') {
      if (!allowMatchingConflictCompletion) return false
      const stillAtBase = current.sync.revision === baseRevision
      const alreadyReconciledWrite =
        current.sync.revision === written.revision && current.sync.confirmedText === written.text
      if (!stillAtBase && !alreadyReconciledWrite) return false
    }

    const state = this.documentStore.getState()
    const marked = state.markSettingsDocumentSaved({
      documentKey: document.key,
      revision: written.revision,
      savedContentRevision,
      savedText: posted,
    })
    if (!marked) return false
    if (written.text === posted) return true
    return state.replaceUnsyncedEditorDocumentText(document.key, written.text)
  }

  private async enterConflict(documentKey: DocumentKey, target: SettingsWriteTarget) {
    const cached = this.queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document())
    let snapshot: SettingsSnapshot | undefined
    try {
      snapshot = await refreshConfirmedSettings(this.queryClient)
    } catch {
      const cachedFile = cached?.layers.find((layer) => layer.id === target)?.file
      this.documentStore
        .getState()
        .markSettingsDocumentConflict(documentKey, cachedFile?.text ?? null, null)
      this.scheduleConflictRefresh(documentKey, target)
      return
    }
    const file = snapshot.layers.find((layer) => layer.id === target)?.file
    if (!file) {
      this.documentStore.getState().markSettingsDocumentConflict(documentKey, null, null)
      return
    }

    this.documentStore
      .getState()
      .markSettingsDocumentConflict(documentKey, file.text, file.revision)
  }

  private scheduleConflictRefresh(documentKey: DocumentKey, target: SettingsWriteTarget) {
    void this.queryClient.invalidateQueries({ queryKey: settingsKeys.document() })
    void refreshConfirmedSettings(this.queryClient)
      .then((snapshot) => {
        const file = snapshot.layers.find((layer) => layer.id === target)?.file
        if (!file) return

        this.documentStore
          .getState()
          .markSettingsDocumentConflict(documentKey, file.text, file.revision)
      })
      .catch(() => undefined)
  }
}

function rawWriteId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  fallbackRawWriteSequence += 1
  return `${clientInstanceId()}:settings-raw:${Date.now()}:${fallbackRawWriteSequence}`
}
