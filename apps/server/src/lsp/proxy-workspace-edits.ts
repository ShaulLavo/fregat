import type { LspProxyConnection } from './proxy-connection'
import { isRecord } from '@workspace/utils/objects'
import type { SharedDocument, OwnerDocumentState } from './proxy-session'
import { isSafeDocumentVersion, safeSum } from './proxy-protocol'

export type CapturedDocumentProvenance = {
  readonly backendVersion: number
  readonly owner: Readonly<OwnerDocumentState> | null
  readonly syncEpoch: number
  readonly text: string
}

export type WorkspaceEditProvenance = {
  readonly connection: LspProxyConnection
  readonly documents: ReadonlyMap<string, CapturedDocumentProvenance>
}

type WorkspaceEditTranslation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false }

export function workspaceEditResponseMethod(method: string): boolean {
  if (method === 'textDocument/rename') return true
  if (method === 'textDocument/codeAction') return true

  return method === 'codeAction/resolve'
}

export function translateWorkspaceEditResponse(
  method: string,
  result: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (method === 'textDocument/rename') {
    return translateWorkspaceEdit(result, provenance, documents)
  }
  if (method === 'textDocument/codeAction') {
    return translateCodeActionList(result, provenance, documents)
  }
  if (method === 'codeAction/resolve') {
    return translateCodeAction(result, provenance, documents)
  }

  return translated(result)
}

function translateCodeActionList(
  value: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (!Array.isArray(value)) return translated(value)

  const actions: unknown[] = []
  for (const action of value) {
    const result = translateCodeAction(action, provenance, documents)
    if (!result.ok) return result
    actions.push(result.value)
  }
  return translated(actions)
}

function translateCodeAction(
  value: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (!isRecord(value)) return translated(value)
  if (!Object.hasOwn(value, 'edit')) return translated(value)

  const edit = translateWorkspaceEdit(value.edit, provenance, documents)
  if (!edit.ok) return edit

  return translated({ ...value, edit: edit.value })
}

function translateWorkspaceEdit(
  value: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (!isRecord(value)) return translated(value)
  if (value.documentChanges === undefined) return translated(value)
  if (!Array.isArray(value.documentChanges)) return translated(value)

  const documentChanges: unknown[] = []
  for (const change of value.documentChanges) {
    const result = translateDocumentChange(change, provenance, documents)
    if (!result.ok) return result
    documentChanges.push(result.value)
  }

  return translated({ ...value, documentChanges })
}

function translateDocumentChange(
  value: unknown,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): WorkspaceEditTranslation {
  if (!isRecord(value)) return translated(value)
  if (!isRecord(value.textDocument)) return translated(value)

  const document = value.textDocument
  if (typeof document.uri !== 'string') return translationFailure()
  if (document.version === null) return translated(value)
  if (!isSafeDocumentVersion(document.version)) return translationFailure()

  const version = translatedDocumentVersion(document.uri, document.version, provenance, documents)
  if (version === null) return translationFailure()

  return translated({
    ...value,
    textDocument: { ...document, version },
  })
}

function translatedDocumentVersion(
  uri: string,
  backendVersion: number,
  provenance: WorkspaceEditProvenance,
  documents: ReadonlyMap<string, SharedDocument>,
): number | null {
  const captured = provenance.documents.get(uri)
  if (!captured?.owner) return null
  if (!documentProvenanceIsCurrent(uri, captured, provenance.connection, documents)) return null

  const delta = backendVersion - captured.backendVersion
  if (!Number.isSafeInteger(delta)) return null
  if (delta < 0) return null

  return safeSum(captured.owner.clientVersion, delta)
}

function documentProvenanceIsCurrent(
  uri: string,
  captured: CapturedDocumentProvenance,
  connection: LspProxyConnection,
  documents: ReadonlyMap<string, SharedDocument>,
): boolean {
  const capturedOwner = captured.owner
  if (!capturedOwner) return false
  if (!capturedOwnerIsSynchronized(capturedOwner, captured)) return false

  const current = documents.get(uri)
  const currentOwner = current?.owners.get(connection)
  if (!current || !currentOwner) return false
  if (current.backendVersion !== captured.backendVersion) return false
  if (current.syncEpoch !== captured.syncEpoch) return false
  if (current.text !== captured.text) return false

  return ownerStatesEqual(currentOwner, capturedOwner)
}

function capturedOwnerIsSynchronized(
  owner: Readonly<OwnerDocumentState>,
  document: CapturedDocumentProvenance,
): boolean {
  if (owner.text !== document.text) return false
  if (owner.lastSyncEpoch !== document.syncEpoch) return false

  return owner.synchronizedBackendVersion === document.backendVersion
}

function ownerStatesEqual(
  current: Readonly<OwnerDocumentState>,
  captured: Readonly<OwnerDocumentState>,
): boolean {
  if (current.clientVersion !== captured.clientVersion) return false
  if (current.text !== captured.text) return false
  if (current.contentEpoch !== captured.contentEpoch) return false
  if (current.lastSyncEpoch !== captured.lastSyncEpoch) return false

  return current.synchronizedBackendVersion === captured.synchronizedBackendVersion
}

function translated(value: unknown): WorkspaceEditTranslation {
  return { ok: true, value }
}

function translationFailure(): WorkspaceEditTranslation {
  return { ok: false }
}
