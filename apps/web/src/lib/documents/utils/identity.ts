import * as v from 'valibot'
import type { SettingsWriteTarget } from '@workspace/contracts'
import type {
  ConflictId,
  DocumentKey,
  DocumentRef,
  FileDocumentRef,
  FileResource,
  FilesystemPath,
  GitComparison,
  SettingsDocumentRef,
  TabId,
  WorkspaceRoot,
} from '@/lib/documents/utils/types'

const pathSchema = v.pipe(
  v.string(),
  v.check((value) => !value.includes('\0')),
)
const nonemptySchema = v.pipe(v.string(), v.minLength(1))

export function filesystemPath(value: string): FilesystemPath {
  return v.parse(pathSchema, value) as FilesystemPath
}

export function workspaceRoot(value: string): WorkspaceRoot {
  return filesystemPath(value)
}

export function fileResource(path: FilesystemPath): FileResource {
  return { path }
}

export function fileDocument(resource: FileResource): FileDocumentRef {
  return { kind: 'file', resource }
}

export function settingsJsonDocument(target: SettingsWriteTarget): SettingsDocumentRef {
  return { kind: 'settings-json', target }
}

export function tabId(value: string): TabId {
  return v.parse(nonemptySchema, value) as TabId
}

export function createTabId(): TabId {
  return tabId(`editor-tab:${crypto.randomUUID()}`)
}

export function conflictId(value: string): ConflictId {
  return v.parse(nonemptySchema, value) as ConflictId
}

export function documentKey(document: DocumentRef): DocumentKey {
  return JSON.stringify(identityParts(document)) as DocumentKey
}

// Equality without the key: this runs inside store equality functions, where stringifying
// every document on every comparison is the cost that shows up.
export function sameDocument(left: DocumentRef, right: DocumentRef): boolean {
  return left === right || sameIdentityParts(identityParts(left), identityParts(right))
}

export function fileDocumentKey(path: FilesystemPath): DocumentKey {
  return documentKey(fileDocument(fileResource(path)))
}

function sameIdentityParts(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false
  return left.every((part, index) => part === right[index])
}

function identityParts(document: DocumentRef): readonly unknown[] {
  switch (document.kind) {
    case 'file':
      return [document.kind, document.resource.path]
    case 'settings-json':
      return [document.kind, document.target]
    case 'git-ref':
      return [document.kind, document.source.path, document.source.ref]
    case 'git-diff':
      return [document.kind, ...comparisonIdentity(document.source)]
    case 'compare-saved':
      return [document.kind, document.file.path]
    case 'conflict':
      return [document.kind, document.conflictId]
    case 'search':
      return [document.kind, document.root]
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

function comparisonIdentity(source: GitComparison): readonly unknown[] {
  const revisions = [
    source.oldObjectId ?? null,
    source.newObjectId ?? null,
    source.oldPath ?? null,
    source.status ?? null,
  ]
  if (source.kind === 'snapshot')
    return [source.kind, source.path, source.source ?? null, ...revisions]
  const range = [
    source.owner,
    source.sessionId,
    source.fromTurnCount,
    source.toTurnCount,
    ...revisions,
  ]
  switch (source.kind) {
    case 'checkpoint-file':
      return [source.kind, source.file.path, ...range]
    case 'checkpoint-session':
    case 'checkpoint-turn':
      return [source.kind, ...range]
    default: {
      const exhaustive: never = source
      return exhaustive
    }
  }
}
