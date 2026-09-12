import * as v from 'valibot'
import { sessionIdSchema } from '@workspace/contracts'
import {
  conflictId,
  fileDocument,
  fileResource,
  filesystemPath,
  settingsJsonDocument,
} from '@/lib/documents/utils/identity'
import { checkpointRequest } from '@/lib/documents/utils/comparisons'
import { documentTab, settingsTab } from '@/lib/documents/utils/tabs'
import type {
  DocumentRef,
  GitComparison,
  SettingsDocumentRef,
  TabContent,
  WorkspaceRoot,
} from '@/lib/documents/utils/types'

const PREFIXES = [
  'settings:',
  'settings-json:',
  'git-ref:',
  'git-diff:',
  'compare-saved:',
  'conflict-diff:',
  'search-buffer:',
] as const
const statusSchema = v.picklist([
  'added',
  'deleted',
  'ignored',
  'modified',
  'renamed',
  'untracked',
  'unmodified',
  'conflicted',
])
const revisionEntries = {
  oldObjectId: v.optional(v.string()),
  newObjectId: v.optional(v.string()),
  oldPath: v.optional(v.string()),
  status: v.optional(statusSchema),
}
const refSchema = v.object({
  version: v.literal(1),
  path: v.pipe(v.string(), v.minLength(1)),
  ref: v.pipe(v.string(), v.minLength(1)),
})
const snapshotSchema = v.pipe(
  v.object({
    ...revisionEntries,
    version: v.literal(2),
    path: v.string(),
    source: v.optional(v.picklist(['staged', 'worktree'])),
  }),
  v.check((value) => Boolean(value.oldObjectId || value.newObjectId)),
)
const checkpointSchema = v.pipe(
  v.object({
    ...revisionEntries,
    version: v.literal(1),
    path: v.string(),
    filePath: v.optional(v.string()),
    scope: v.optional(v.picklist(['file', 'session', 'turn'])),
    sessionId: sessionIdSchema,
    fromTurnCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
    toTurnCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
  v.check((value) => value.toTurnCount >= value.fromTurnCount),
)

export type DecodedDocumentTarget =
  | { readonly kind: 'tab'; readonly content: TabContent }
  | { readonly kind: 'internal'; readonly document: SettingsDocumentRef }
  | { readonly kind: 'invalid'; readonly reason: string }

export function decodeDocumentTarget(value: unknown, owner: WorkspaceRoot): DecodedDocumentTarget {
  if (typeof value !== 'string' || value.length === 0) return invalidTarget()
  if (value === 'settings:') return { kind: 'tab', content: settingsTab() }
  if (value.startsWith('settings-json:')) return decodeSettings(value)
  if (value.startsWith('git-ref:')) return decodeReference(value)
  if (value.startsWith('git-diff:')) return decodeComparison(value, owner)
  if (value.startsWith('compare-saved:')) return decodeSimple(value, 'compare-saved')
  if (value.startsWith('conflict-diff:')) return decodeSimple(value, 'conflict')
  if (value.startsWith('search-buffer:')) return decodeSimple(value, 'search')
  if (PREFIXES.some((prefix) => value.startsWith(prefix))) return invalidTarget()
  if (value.includes('\0')) return invalidTarget()
  return tabResult(fileDocument(fileResource(filesystemPath(value))))
}

export function encodedSettingsTab(): string {
  return 'settings:'
}

export function encodedViewTarget(
  document: Exclude<DocumentRef, { readonly kind: 'file' }>,
): string {
  switch (document.kind) {
    case 'settings-json':
      return `settings-json:${document.target}`
    case 'conflict':
      return `conflict-diff:${encodeURIComponent(document.conflictId)}`
    case 'compare-saved':
      return `compare-saved:${encodeURIComponent(document.file.path)}`
    case 'search':
      return `search-buffer:${encodeURIComponent(document.root)}`
    case 'git-ref':
      return `git-ref:${encodeURIComponent(JSON.stringify({ path: document.source.path, ref: document.source.ref, version: 1 }))}`
    case 'git-diff':
      return encodedComparison(document.source)
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

function encodedComparison(source: GitComparison): string {
  if (source.kind === 'snapshot') {
    const { newObjectId, oldObjectId, oldPath, path, status } = source
    const payload = {
      newObjectId,
      oldObjectId,
      oldPath,
      path,
      source: source.source,
      status,
      version: 2,
    }
    return `git-diff:v2:${encodeURIComponent(JSON.stringify(payload))}`
  }
  const request = checkpointRequest(source)
  const payload = {
    filePath: source.kind === 'checkpoint-file' ? source.file.path : undefined,
    fromTurnCount: source.fromTurnCount,
    newObjectId: source.newObjectId,
    oldObjectId: source.oldObjectId,
    oldPath: source.oldPath,
    path: request.path,
    scope: request.scope,
    status: source.status,
    sessionId: source.sessionId,
    toTurnCount: source.toTurnCount,
    version: 1,
  }
  return `git-diff:checkpoint-v1:${encodeURIComponent(JSON.stringify(payload))}`
}

function decodeSettings(value: string): DecodedDocumentTarget {
  const target = value.slice('settings-json:'.length)
  if (target !== 'user' && target !== 'workspace') return invalidTarget()
  return { kind: 'internal', document: settingsJsonDocument(target) }
}

function decodeReference(value: string): DecodedDocumentTarget {
  const result = v.safeParse(refSchema, jsonPayload(value.slice('git-ref:'.length)))
  if (!result.success || result.output.path.includes('\0')) return invalidTarget()
  return tabResult({
    kind: 'git-ref',
    source: { path: filesystemPath(result.output.path), ref: result.output.ref },
  })
}

function decodeComparison(value: string, owner: WorkspaceRoot): DecodedDocumentTarget {
  const body = value.slice('git-diff:'.length)
  if (body.startsWith('v2:')) return decodeSnapshot(body.slice(3))
  if (body.startsWith('checkpoint-v1:'))
    return decodeCheckpoint(body.slice('checkpoint-v1:'.length), owner)
  return invalidTarget()
}

function decodeSnapshot(encoded: string): DecodedDocumentTarget {
  const result = v.safeParse(snapshotSchema, jsonPayload(encoded))
  if (!result.success) return invalidTarget()
  const value = result.output
  if (invalidPaths(value.path, value.oldPath)) return invalidTarget()
  return tabResult({
    kind: 'git-diff',
    source: {
      kind: 'snapshot',
      path: filesystemPath(value.path),
      source: value.source,
      newObjectId: value.newObjectId,
      oldObjectId: value.oldObjectId,
      oldPath: value.oldPath === undefined ? undefined : filesystemPath(value.oldPath),
      status: value.status,
    },
  })
}

function decodeCheckpoint(encoded: string, owner: WorkspaceRoot): DecodedDocumentTarget {
  const result = v.safeParse(checkpointSchema, jsonPayload(encoded))
  if (!result.success) return invalidTarget()
  const value = result.output
  if (invalidPaths(value.path, value.filePath, value.oldPath)) return invalidTarget()
  const range = {
    owner,
    sessionId: value.sessionId,
    fromTurnCount: value.fromTurnCount,
    toTurnCount: value.toTurnCount,
    oldObjectId: value.oldObjectId,
    newObjectId: value.newObjectId,
    oldPath: value.oldPath === undefined ? undefined : filesystemPath(value.oldPath),
    status: value.status,
  }
  let source: GitComparison
  if (value.scope === 'session') source = { ...range, kind: 'checkpoint-session' }
  else if (value.scope === 'turn') source = { ...range, kind: 'checkpoint-turn' }
  else
    source = {
      ...range,
      kind: 'checkpoint-file',
      file: fileResource(filesystemPath(value.filePath ?? value.path)),
    }
  return tabResult({ kind: 'git-diff', source })
}

function decodeSimple(
  value: string,
  kind: 'compare-saved' | 'conflict' | 'search',
): DecodedDocumentTarget {
  const decoded = textPayload(value.slice(value.indexOf(':') + 1))
  if (decoded === null || decoded.includes('\0')) return invalidTarget()
  if (kind === 'search') return tabResult({ kind: 'search', root: filesystemPath(decoded) })
  if (decoded.length === 0) return invalidTarget()
  if (kind === 'conflict') return tabResult({ kind: 'conflict', conflictId: conflictId(decoded) })
  return tabResult({ kind: 'compare-saved', file: fileResource(filesystemPath(decoded)) })
}

function textPayload(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function jsonPayload(value: string): unknown {
  const decoded = textPayload(value)
  if (decoded === null) return null
  try {
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function invalidPaths(...values: readonly (string | undefined)[]): boolean {
  return values.some((value) => value?.includes('\0'))
}

function tabResult(document: Exclude<DocumentRef, SettingsDocumentRef>): DecodedDocumentTarget {
  return { kind: 'tab', content: documentTab(document) }
}

function invalidTarget(): DecodedDocumentTarget {
  return { kind: 'invalid', reason: 'Invalid document target' }
}
