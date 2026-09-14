import { sessionIdSchema, type SessionId } from '@workspace/contracts'
import * as v from 'valibot'
import { decodePath, decodeSegment, encodePath, encodeSegment } from './path-token'

export type EditorReference =
  | { readonly kind: 'settings' | 'search' }
  | { readonly kind: 'file' | 'compare'; readonly path: string }
  | { readonly kind: 'ref'; readonly ref: string; readonly path: string }
  | {
      readonly kind: 'snapshot'
      readonly source: 'worktree' | 'staged' | 'branch' | 'historical'
      readonly revisionToken: string
      readonly path: string
    }
  | {
      readonly kind: 'checkpoint'
      readonly sessionId: SessionId
      readonly turnsToken: string
      readonly path: string | null
    }

export type ChatReference =
  | { readonly kind: 'draft' }
  | { readonly kind: 'session'; readonly sessionId: SessionId }

const OBJECT_ID = /^[0-9a-f]{40,64}$/i
const STATUS = v.picklist([
  'added',
  'conflicted',
  'deleted',
  'ignored',
  'modified',
  'renamed',
  'unmodified',
  'untracked',
])

export function chatReferenceForToken(token: string | null): ChatReference | null {
  if (token === 't/new') return { kind: 'draft' }
  if (!token?.startsWith('t/') || token.split('/').length !== 2) return null
  const parsed = v.safeParse(sessionIdSchema, decodeSegment(token.slice(2)))
  return parsed.success ? { kind: 'session', sessionId: parsed.output } : null
}

export function tokenForChatReference(reference: ChatReference) {
  return reference.kind === 'draft' ? 't/new' : `t/${encodeSegment(reference.sessionId)}`
}

export function editorReferenceForToken(token: string | null): EditorReference | null {
  if (token === 'settings') return { kind: 'settings' }
  if (token === 's') return { kind: 'search' }
  if (!token) return null
  const [kind, ...segments] = token.split('/')
  if (kind === 'f' || kind === 'c') {
    const path = decodePath('', segments)
    return path ? { kind: kind === 'f' ? 'file' : 'compare', path } : null
  }
  if (kind === 'r') return refReference(segments)
  if (kind === 'd') return snapshotReference(segments)
  if (kind === 'k') return checkpointReference(segments)
  return null
}

export function tokenForEditorReference(reference: EditorReference): string {
  switch (reference.kind) {
    case 'settings':
      return 'settings'
    case 'search':
      return 's'
    case 'file':
      return `f/${encodePath(reference.path)}`
    case 'compare':
      return `c/${encodePath(reference.path)}`
    case 'ref':
      return `r/${encodeSegment(reference.ref)}/${encodePath(reference.path)}`
    case 'snapshot':
      return `d/${reference.source}/${reference.revisionToken}/${encodePath(reference.path)}`
    case 'checkpoint': {
      const head = `k/${encodeSegment(reference.sessionId)}/${reference.turnsToken}`
      return reference.path === null ? head : `${head}/${encodePath(reference.path)}`
    }
  }
}

function refReference(segments: readonly string[]): EditorReference | null {
  const ref = decodeSegment(segments[0])
  const path = decodePath('', segments.slice(1))
  return ref && path ? { kind: 'ref', ref, path } : null
}

function snapshotReference(segments: readonly string[]): EditorReference | null {
  const [source, revisionToken] = segments
  if (
    source !== 'worktree' &&
    source !== 'staged' &&
    source !== 'branch' &&
    source !== 'historical'
  )
    return null
  if (!revisionToken || !validRevision(revisionToken)) return null
  const path = decodePath('', segments.slice(2))
  return path
    ? { kind: 'snapshot', source, revisionToken: normalizedMetadata(revisionToken), path }
    : null
}

function checkpointReference(segments: readonly string[]): EditorReference | null {
  const session = v.safeParse(sessionIdSchema, decodeSegment(segments[0]))
  const turnsToken = segments[1]
  if (!session.success || !turnsToken || !validTurns(turnsToken)) return null
  const path = segments.length > 2 ? decodePath('', segments.slice(2)) : null
  if (segments.length > 2 && path === null) return null
  if (path !== null && turnsToken.endsWith('!turn')) return null
  return {
    kind: 'checkpoint',
    sessionId: session.output,
    turnsToken: normalizedMetadata(turnsToken),
    path,
  }
}

function validRevision(token: string) {
  const [range] = token.split(',')
  const objects = range?.split('..') ?? []
  if (objects.length !== 2 || objects.every((part) => part === '_')) return false
  if (!objects.every((part) => part === '_' || OBJECT_ID.test(part))) return false
  return true
}

function validTurns(token: string) {
  const value = token.endsWith('!turn') ? token.slice(0, -5) : token
  const [range] = value.split(',')
  if (!range || !/^\d+\.\.\d+$/.test(range)) return false
  const [from, to] = range.split('..').map(Number)
  if (
    from === undefined ||
    to === undefined ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to)
  )
    return false
  return from <= to
}

function normalizedMetadata(token: string) {
  const suffix = token.endsWith('!turn') ? '!turn' : ''
  const value = suffix ? token.slice(0, -suffix.length) : token
  const [range, ...extras] = value.split(',')
  const fields = new Map<string, string>()
  for (const extra of extras) {
    const equals = extra.indexOf('=')
    const key = extra.slice(0, equals)
    if (equals < 0 || !validExtra(key, extra.slice(equals + 1))) continue
    fields.set(key, extra)
  }
  return [range, ...fields.values()].join(',') + suffix
}

function validExtra(key: string, raw: string) {
  const value = decodeSegment(raw)
  if (!value) return false
  if (key === 'o' || key === 'n') return OBJECT_ID.test(value)
  if (key === 's') return v.safeParse(STATUS, value).success
  if (key === 'r') return decodePath('', [raw]) !== null
  return false
}

export const editorReferenceSchema = v.pipe(
  v.variant('kind', [
    v.object({ kind: v.literal('settings') }),
    v.object({ kind: v.literal('search') }),
    v.object({ kind: v.literal('file'), path: v.string() }),
    v.object({ kind: v.literal('compare'), path: v.string() }),
    v.object({ kind: v.literal('ref'), ref: v.string(), path: v.string() }),
    v.object({
      kind: v.literal('snapshot'),
      source: v.picklist(['worktree', 'staged', 'branch', 'historical']),
      revisionToken: v.string(),
      path: v.string(),
    }),
    v.object({
      kind: v.literal('checkpoint'),
      sessionId: sessionIdSchema,
      turnsToken: v.string(),
      path: v.nullable(v.string()),
    }),
  ]),
  v.check((reference) => editorReferenceForToken(tokenForEditorReference(reference)) !== null),
)

export const chatReferenceSchema = v.variant('kind', [
  v.object({ kind: v.literal('draft') }),
  v.object({ kind: v.literal('session'), sessionId: sessionIdSchema }),
])
