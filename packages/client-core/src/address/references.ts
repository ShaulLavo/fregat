import {
  GIT_OBJECT_ID_PATTERN,
  gitSnapshotTargetSchema,
  type GitSnapshotTarget,
  type GitRevisionSide,
  isGitFileStatus,
  sessionIdSchema,
  type SessionId,
} from '@workspace/contracts'
import * as v from 'valibot'
import { decodePath, decodeSegment, encodePath, encodeSegment } from './path-token'
import { toWorkspaceAbsolute, toWorkspaceRelative } from '../files/path'

export type EditorReference =
  | { readonly kind: 'settings' | 'search' }
  | { readonly kind: 'file' | 'compare' | 'history'; readonly path: string }
  | { readonly kind: 'ref'; readonly ref: string; readonly path: string }
  | {
      readonly kind: 'snapshot'
      readonly source: 'worktree' | 'staged' | 'historical' | 'captured-review'
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
  | { readonly kind: 'draft'; readonly draftId?: string }
  | { readonly kind: 'session'; readonly sessionId: SessionId }

export const draftAddressTokenSchema = v.pipe(
  v.string(),
  v.regex(/^draft-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i),
  v.brand('DraftAddressToken'),
)

export function chatReferenceForToken(token: string | null): ChatReference | null {
  if (token === 't/new') return { kind: 'draft' }
  if (token?.startsWith('t/draft-')) {
    const id = v.safeParse(v.pipe(v.string(), v.uuid()), token.slice(8))
    return id.success ? { kind: 'draft', draftId: id.output } : null
  }
  if (!token?.startsWith('t/') || token.split('/').length !== 2) return null
  const parsed = v.safeParse(sessionIdSchema, decodeSegment(token.slice(2)))
  return parsed.success ? { kind: 'session', sessionId: parsed.output } : null
}

export function tokenForChatReference(reference: ChatReference) {
  if (reference.kind === 'draft')
    return reference.draftId ? `t/draft-${reference.draftId}` : 't/new'
  return `t/${encodeSegment(reference.sessionId)}`
}

export function editorReferenceForToken(token: string | null): EditorReference | null {
  if (token === 'settings') return { kind: 'settings' }
  if (token === 's') return { kind: 'search' }
  if (!token) return null
  const [kind, ...segments] = token.split('/')
  if (kind === 'f' || kind === 'c' || kind === 'h') {
    const path = decodePath('', segments)
    return path ? { kind: PATH_REFERENCE_KINDS[kind], path } : null
  }
  if (kind === 'r') return refReference(segments)
  if (kind === 'd') return snapshotReference(segments)
  if (kind === 'k') return checkpointReference(segments)
  return null
}

const PATH_REFERENCE_KINDS = { c: 'compare', f: 'file', h: 'history' } as const

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
    case 'history':
      return `h/${encodePath(reference.path)}`
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
    source !== 'historical' &&
    source !== 'captured-review'
  )
    return null
  if (!revisionToken || !validSnapshotRevision(source, revisionToken)) return null
  const path = decodePath('', segments.slice(2))
  return path ? { kind: 'snapshot', source, revisionToken, path } : null
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

function validSnapshotRevision(
  source: Extract<EditorReference, { kind: 'snapshot' }>['source'],
  token: string,
) {
  if (source === 'worktree' || source === 'staged') return token === 'live'
  return (
    snapshotTargetForReference(
      { kind: 'snapshot', source, revisionToken: token, path: 'file' },
      '/',
    ) !== null
  )
}

export function snapshotTargetForReference(
  reference: Extract<EditorReference, { kind: 'snapshot' }>,
  rootPath: string,
): GitSnapshotTarget | null {
  const path = toWorkspaceAbsolute(rootPath, reference.path)
  if (path === null) return null
  if (reference.source === 'worktree' || reference.source === 'staged')
    return reference.revisionToken === 'live'
      ? { kind: 'moving', rootPath, path, changeSource: reference.source }
      : null
  const [range, ...extras] = reference.revisionToken.split(',')
  const sides = range?.split('..') ?? []
  if (sides.length !== 2) return null
  const fields = new Map<string, string>()
  for (const extra of extras) {
    const equals = extra.indexOf('=')
    const key = extra.slice(0, equals)
    const value = decodeSegment(extra.slice(equals + 1))
    if (equals < 0 || value === null || fields.has(key)) return null
    fields.set(key, value)
  }
  const historical = reference.source === 'historical'
  if (
    [...fields.keys()].some((key) => !['s', 'r', ...(historical ? ['c', 'p'] : [])].includes(key))
  )
    return null
  const oldPath = toWorkspaceAbsolute(rootPath, fields.get('r') ?? '')
  if (oldPath === null) return null
  const revision = {
    old: sideForToken(sides[0]),
    new: sideForToken(sides[1]),
    oldPath,
    status: fields.get('s'),
  }
  const origin = {
    id: fields.get('c'),
    parents: fields.get('p') === '_' ? [] : fields.get('p')?.split('+'),
  }
  const parsed = v.safeParse(
    gitSnapshotTargetSchema,
    historical
      ? { kind: 'historical', rootPath, path, revision, origin }
      : { kind: 'captured-review', rootPath, path, revision },
  )
  return parsed.success ? parsed.output : null
}

export function editorReferenceForSnapshotTarget(
  target: GitSnapshotTarget,
): Extract<EditorReference, { kind: 'snapshot' }> | null {
  const path = toWorkspaceRelative(target.rootPath, target.path)
  if (!path) return null
  if (target.kind === 'moving')
    return { kind: 'snapshot', source: target.changeSource, revisionToken: 'live', path }
  const oldPath = toWorkspaceRelative(target.rootPath, target.revision.oldPath)
  if (!oldPath) return null
  const fields = [`s=${target.revision.status}`, `r=${encodeSegment(oldPath)}`]
  if (target.kind === 'historical')
    fields.push(`c=${target.origin.id}`, `p=${target.origin.parents.join('+') || '_'}`)
  return {
    kind: 'snapshot',
    source: target.kind,
    revisionToken: `${tokenForSide(target.revision.old)}..${tokenForSide(target.revision.new)},${fields.join(',')}`,
    path,
  }
}

function sideForToken(token: string | undefined) {
  if (token === '_') return { kind: 'missing' }
  if (token === '?') return { kind: 'unresolved' }
  return { kind: 'blob', objectId: token }
}

function tokenForSide(side: GitRevisionSide) {
  if (side.kind === 'blob') return side.objectId
  return side.kind === 'missing' ? '_' : '?'
}

function validTurns(token: string) {
  const value = token.endsWith('!turn') ? token.slice(0, -5) : token
  const [range, ...extras] = value.split(',')
  if (
    extras.filter((extra) => extra.startsWith('w=')).length !== 1 ||
    !extras.some((extra) => /^w=[01]$/.test(extra))
  )
    return false
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
  if (key === 'w') return value === '0' || value === '1'
  if (key === 'o' || key === 'n') return GIT_OBJECT_ID_PATTERN.test(value)
  if (key === 's') return isGitFileStatus(value)
  if (key === 'r') return decodePath('', [raw]) !== null
  return false
}

export const editorReferenceSchema = v.pipe(
  v.variant('kind', [
    v.object({ kind: v.literal('settings') }),
    v.object({ kind: v.literal('search') }),
    v.object({ kind: v.literal('file'), path: v.string() }),
    v.object({ kind: v.literal('compare'), path: v.string() }),
    v.object({ kind: v.literal('history'), path: v.string() }),
    v.object({ kind: v.literal('ref'), ref: v.string(), path: v.string() }),
    v.object({
      kind: v.literal('snapshot'),
      source: v.picklist(['worktree', 'staged', 'historical', 'captured-review']),
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
  v.object({ kind: v.literal('draft'), draftId: v.optional(v.pipe(v.string(), v.uuid())) }),
  v.object({ kind: v.literal('session'), sessionId: sessionIdSchema }),
])
