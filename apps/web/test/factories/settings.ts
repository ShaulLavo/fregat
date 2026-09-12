import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import {
  DEFAULT_SETTING_VALUES,
  type SettingsSnapshot,
  type SettingsValues,
  type SettingsWriteTarget,
} from '@workspace/contracts'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { createClientInvariantError } from '@/lib/structured-errors'

type SettingsSnapshotInput = {
  readonly epoch?: string
  readonly sequence?: number
  readonly userRaw?: Readonly<Record<string, unknown>>
  readonly userRevision?: string
  readonly userText?: string
  readonly values?: Partial<SettingsValues>
  readonly workspaceRaw?: Readonly<Record<string, unknown>>
  readonly workspaceRevision?: string
  readonly workspaceText?: string
}

export function settingsSnapshot({
  epoch = 'settings-test',
  sequence = 0,
  userRaw = {},
  userRevision = 'user-revision',
  userText = '{}\n',
  values = {},
  workspaceRaw = {},
  workspaceRevision = 'workspace-revision',
  workspaceText = '{}\n',
}: SettingsSnapshotInput = {}): SettingsSnapshot {
  return {
    diagnostics: [],
    layers: [
      {
        file: settingsFile(userText, userRevision),
        id: 'user',
        present: Object.keys(userRaw).length > 0,
        raw: userRaw,
      },
      {
        file: settingsFile(workspaceText, workspaceRevision),
        id: 'workspace',
        present: Object.keys(workspaceRaw).length > 0,
        raw: workspaceRaw,
      },
      { id: 'policy', present: false, raw: {} },
    ],
    serverVersion: { epoch, sequence },
    values: { ...DEFAULT_SETTING_VALUES, ...values },
  }
}

function settingsFile(text: string, revision: string) {
  return { keyRanges: {}, parseErrors: [], revision, text }
}

export function settingsLayerFile(snapshot: SettingsSnapshot, target: SettingsWriteTarget) {
  const file = snapshot.layers.find((layer) => layer.id === target)?.file
  if (!file) throw createClientInvariantError(`Settings fixture has no ${target} file`)
  return file
}

export function seedSettingsBuffer(
  store: EditorDocumentStoreApi,
  snapshot: SettingsSnapshot,
  target: SettingsWriteTarget,
  text: string,
) {
  const id = documentKey(settingsJsonDocument(target))
  const file = settingsLayerFile(snapshot, target)
  const document = store.getState().ensureSettingsDocument(settingsJsonDocument(target), {
    content: text,
    revision: file.revision,
  })
  store.getState().setLiveEditorDocumentDirty(id, true)
  return document
}
