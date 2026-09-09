import {
  decodePath,
  encodePath,
  encodeSegment,
  decodeSegment,
} from '@workspace/client-core/address/path-token'
import {
  parseCompareSavedDocumentId,
  compareSavedDocumentId,
} from '@/features/editor/utils/compare-saved-document'
import { parseConflictDiffDocumentId } from '@/features/editor/utils/conflict-diff-document'
import {
  checkpointDiffDocumentId,
  parseDiffDocumentId,
  snapshotDiffDocumentId,
} from '@/features/git/utils/diff-document'
import { parseRefDocumentId, refDocumentId } from '@/features/git/utils/ref-document'
import {
  parseSearchBufferDocumentId,
  searchBufferDocumentId,
} from '@/features/search/utils/buffer-document'
import { SETTINGS_DOCUMENT_TOKEN } from '@workspace/client-core/address/grammar'
import { isSettingsDocumentId, settingsDocumentId } from '@/features/settings/utils/document'
import { toWorkspaceAbsolute, toWorkspaceRelative } from '@workspace/client-core/files/path'
import { sessionIdSchema, type SessionId } from '@workspace/contracts'
import * as v from 'valibot'

export type DocumentTokenResult =
  /** An addressable document, as its token. */
  | { readonly kind: 'token'; readonly token: string }
  /** No token can encode this document; the encoder cannot leak it by accident. */
  | { readonly kind: 'unaddressable'; readonly reason: string }

export type ParsedDocumentToken =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly reason: string }

// Git object ids run 40 hex (SHA-1) through 64 (SHA-256); the server validates exactly
// that range. A fixed-width-40 grammar would reject every id from a SHA-256 repository.
const OBJECT_ID = /^[0-9a-f]{40,64}$/i
const MISSING_OBJECT_ID = '_'
const TURN_SCOPE_SUFFIX = '!turn'

export function documentTokenForPath(rootPath: string | null, path: string): DocumentTokenResult {
  // Reuses the cache's own predicate rather than re-deriving it: a conflict record is
  // born from a watcher event and holds its text in memory, so it cannot survive a
  // reload, let alone a machine.
  if (parseConflictDiffDocumentId(path)) {
    return { kind: 'unaddressable', reason: 'conflict documents are not addressable' }
  }
  if (isSettingsDocumentId(path)) return { kind: 'token', token: SETTINGS_DOCUMENT_TOKEN }
  if (rootPath === null) return { kind: 'unaddressable', reason: 'document requires a workspace' }

  const search = parseSearchBufferDocumentId(path)
  if (search) return searchToken(rootPath, search.rootPath)

  const diff = parseDiffDocumentId(path)
  if (diff) return diffToken(rootPath, diff)

  const ref = parseRefDocumentId(path)
  if (ref) return relativeToken('r', rootPath, ref.path, [encodeSegment(ref.ref)])

  const compareSaved = parseCompareSavedDocumentId(path)
  if (compareSaved) return relativeToken('c', rootPath, compareSaved)

  return relativeToken('f', rootPath, path)
}

export function pathForDocumentToken(rootPath: string | null, token: string): ParsedDocumentToken {
  if (token === SETTINGS_DOCUMENT_TOKEN) return { kind: 'path', path: settingsDocumentId() }
  if (rootPath === null) return { kind: 'rejected', reason: 'document requires a workspace' }

  const segments = token.split('/')
  const kind = segments[0]

  if (kind === 's') return { kind: 'path', path: searchBufferDocumentId(rootPath) }
  if (kind === 'f') return filePath(rootPath, segments.slice(1))
  if (kind === 'c') return compareSavedPath(rootPath, segments.slice(1))
  if (kind === 'r') return refPath(rootPath, segments.slice(1))
  if (kind === 'd') return snapshotDiffPath(rootPath, segments.slice(1))
  if (kind === 'k') return checkpointDiffPath(rootPath, segments.slice(1))

  return { kind: 'rejected', reason: `unknown document token \`${kind ?? ''}\`` }
}

function searchToken(rootPath: string, searchRootPath: string): DocumentTokenResult {
  // The encoded absolute root disappears: the workspace is already in the path.
  if (searchRootPath !== rootPath) {
    return { kind: 'unaddressable', reason: 'search buffer belongs to another workspace' }
  }

  return { kind: 'token', token: 's' }
}

function diffToken(
  rootPath: string,
  diff: NonNullable<ReturnType<typeof parseDiffDocumentId>>,
): DocumentTokenResult {
  if (diff.kind === 'snapshot') {
    const source = diff.source ?? 'worktree'
    const revision = revisionSegment(
      diff.query.oldObjectId,
      diff.query.newObjectId,
      diff.status,
      relativeOrNull(rootPath, diff.query.oldPath),
    )
    if (!revision) return { kind: 'unaddressable', reason: 'diff names no git object' }

    return relativeToken('d', rootPath, diff.path, [source, revision])
  }

  return checkpointToken(rootPath, diff.query)
}

function checkpointToken(
  rootPath: string,
  query: {
    sessionId: SessionId
    fromTurnCount: number
    toTurnCount: number
    scope?: string
    filePath?: string
    oldPath?: string
    status?: string
    oldObjectId?: string
    newObjectId?: string
  },
): DocumentTokenResult {
  const scope = query.scope ?? 'file'
  const turns = `${query.fromTurnCount}..${query.toTurnCount}`
  // The object ids ride along because `checkpointDiffDocumentId` puts them IN the id:
  // dropping them minted a different id on the way back, so a restored checkpoint tab
  // never matched the one the app would open and the workbench kept both.
  const extras = tokenExtras({
    newObjectId: query.newObjectId,
    oldObjectId: query.oldObjectId,
    oldPath: relativeOrNull(rootPath, query.oldPath),
    status: query.status,
  })
  const head = `k/${encodeSegment(query.sessionId)}/${turns}${extras}`

  if (scope === 'session') return { kind: 'token', token: head }
  if (scope === 'turn') return { kind: 'token', token: `${head}${TURN_SCOPE_SUFFIX}` }

  const relative = toWorkspaceRelative(rootPath, query.filePath ?? '')
  if (!relative) {
    return { kind: 'unaddressable', reason: 'checkpoint file is outside this workspace' }
  }

  return { kind: 'token', token: `${head}/${encodePath(relative)}` }
}

function relativeToken(
  kind: string,
  rootPath: string,
  path: string,
  leading: readonly string[] = [],
): DocumentTokenResult {
  const relative = toWorkspaceRelative(rootPath, path)
  if (!relative) return { kind: 'unaddressable', reason: 'document is outside this workspace' }

  return { kind: 'token', token: [kind, ...leading, encodePath(relative)].join('/') }
}

/**
 * `<old>..<new>` plus the two fields the plan drops but the app cannot re-derive:
 * `status`, which the git status query only re-derives while the change is still
 * uncommitted, and `oldPath`, which decides `renamed` and keys the blob-diff query.
 * They ride in this segment because it is the one part of the token that can never
 * contain a `/`.
 */
function revisionSegment(
  oldObjectId: string | undefined,
  newObjectId: string | undefined,
  status: string | undefined,
  oldPath: string | null,
) {
  if (!oldObjectId && !newObjectId) return null

  const range = `${oldObjectId ?? MISSING_OBJECT_ID}..${newObjectId ?? MISSING_OBJECT_ID}`
  // No `o=`/`n=` here: a `d/` token already spells both sides in its range segment.
  return `${range}${tokenExtras({ oldPath, status })}`
}

function tokenExtras({
  newObjectId,
  oldObjectId,
  oldPath,
  status,
}: {
  readonly newObjectId?: string
  readonly oldObjectId?: string
  readonly oldPath: string | null
  readonly status: string | undefined
}) {
  const extras: string[] = []
  if (status) extras.push(`s=${encodeSegment(status)}`)
  if (oldPath) extras.push(`r=${encodeSegment(oldPath)}`)
  if (oldObjectId) extras.push(`o=${oldObjectId}`)
  if (newObjectId) extras.push(`n=${newObjectId}`)

  return extras.length > 0 ? `,${extras.join(',')}` : ''
}

function filePath(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const path = decodePath(rootPath, segments)
  if (!path) return { kind: 'rejected', reason: 'file token names no path' }

  return { kind: 'path', path }
}

function compareSavedPath(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const path = decodePath(rootPath, segments)
  if (!path) return { kind: 'rejected', reason: 'compare token names no path' }

  return { kind: 'path', path: compareSavedDocumentId(path) }
}

function refPath(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const ref = decodeSegment(segments[0])
  const path = decodePath(rootPath, segments.slice(1))
  if (!ref || !path) return { kind: 'rejected', reason: 'ref token needs a ref and a path' }

  return { kind: 'path', path: refDocumentId({ path, ref }) }
}

function snapshotDiffPath(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const source = segments[0]
  if (source === 'branch')
    return { kind: 'unavailable', reason: 'branch diffs are not rendered yet' }
  if (source !== 'staged' && source !== 'worktree') {
    return { kind: 'rejected', reason: 'diff source must be worktree, staged or branch' }
  }

  const revision = parseRevisionSegment(segments[1] ?? '')
  if (!revision) return { kind: 'rejected', reason: 'diff names no usable git object' }

  const path = decodePath(rootPath, segments.slice(2))
  if (!path) return { kind: 'rejected', reason: 'diff token names no path' }

  return {
    kind: 'path',
    path: snapshotDiffDocumentId({
      newObjectId: revision.newObjectId,
      oldObjectId: revision.oldObjectId,
      oldPath: absoluteOrUndefined(rootPath, revision.oldPath),
      path,
      staged: source === 'staged',
      ...missingSidesForStatus(revision.status, revision.oldObjectId),
    } as Parameters<typeof snapshotDiffDocumentId>[0]),
  }
}

function checkpointDiffPath(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const sessionId = sessionIdOrNull(decodeSegment(segments[0]))
  const turnSegment = segments[1] ?? ''
  const isTurnScope = turnSegment.endsWith(TURN_SCOPE_SUFFIX)
  const turns = parseTurnRange(
    isTurnScope ? turnSegment.slice(0, -TURN_SCOPE_SUFFIX.length) : turnSegment,
  )
  if (!sessionId || !turns)
    return { kind: 'rejected', reason: 'checkpoint token needs a session id and a turn range' }

  const filePath = segments.length > 2 ? decodePath(rootPath, segments.slice(2)) : null
  const scope = checkpointScope(filePath, isTurnScope)

  return {
    kind: 'path',
    path: checkpointDiffDocumentId({
      filePath: filePath ?? undefined,
      fromTurnCount: turns.from,
      newObjectId: turns.newObjectId,
      oldObjectId: turns.oldObjectId,
      oldPath: absoluteOrUndefined(rootPath, turns.oldPath),
      // Session- and turn-scope checkpoints carry a synthetic path, matching what the
      // checkpoint query mints for them.
      path: filePath ?? `checkpoint-${scope}-${turns.to}`,
      scope,
      status: gitStatusOrUndefined(turns.status),
      sessionId,
      toTurnCount: turns.to,
    }),
  }
}

/** A trailing path means one file; otherwise the `!turn` marker decides the width. */
function checkpointScope(filePath: string | null, isTurnScope: boolean) {
  if (filePath) return 'file'
  if (isTurnScope) return 'turn'

  return 'session'
}

/**
 * `snapshotDiffDocumentId` does not take a status — it RE-DERIVES one from which side
 * is missing. So restoring the `s=` we carried means restoring the inputs that produce
 * it, not passing it through. Without this a deleted file came back as `modified` and
 * the diff rendered the wrong way round.
 */
function missingSidesForStatus(status: string | undefined, oldObjectId: string | undefined) {
  if (status === 'deleted') return { newFileMissing: true, oldFileMissing: false }
  if (status === 'added' || status === 'untracked') {
    return { newFileMissing: false, oldFileMissing: true }
  }
  if (status === 'modified' || status === 'renamed') {
    return { newFileMissing: false, oldFileMissing: false }
  }

  // No status in the token: fall back to what the object ids imply.
  return { newFileMissing: false, oldFileMissing: !oldObjectId }
}

function parseRevisionSegment(segment: string) {
  const [range, ...extras] = segment.split(',')
  const [oldRaw, newRaw] = range.split('..')
  if (oldRaw === undefined || newRaw === undefined) return null

  const oldObjectId = objectIdOrUndefined(oldRaw)
  const newObjectId = objectIdOrUndefined(newRaw)
  // At least one side must exist; `_.._` names nothing, and the payload check agrees.
  if (oldRaw !== MISSING_OBJECT_ID && !oldObjectId) return null
  if (newRaw !== MISSING_OBJECT_ID && !newObjectId) return null
  if (!oldObjectId && !newObjectId) return null

  // Range last: a `d/` token spells both object ids in its range segment, and the
  // extras carry `o=`/`n=` only for `k/`. Spreading the extras over the range instead
  // would overwrite both sides with `undefined`.
  return { ...parseExtras(extras), newObjectId, oldObjectId }
}

function parseTurnRange(segment: string) {
  const [range, ...extras] = segment.split(',')
  const [fromRaw, toRaw] = range.split('..')
  const from = Number(fromRaw)
  const to = Number(toRaw)
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null
  if (from < 0 || to < from) return null

  return { from, to, ...parseExtras(extras) }
}

function parseExtras(extras: readonly string[]) {
  const byKey = new Map(
    extras.map((extra) => {
      const index = extra.indexOf('=')
      return index < 0 ? ['', ''] : [extra.slice(0, index), decodeSegment(extra.slice(index + 1))]
    }),
  )

  return {
    // Validated, not trusted: an arbitrary URL string must not become a git object id.
    newObjectId: objectIdOrUndefined(byKey.get('n') ?? ''),
    oldObjectId: objectIdOrUndefined(byKey.get('o') ?? ''),
    oldPath: byKey.get('r') ?? undefined,
    status: byKey.get('s') ?? undefined,
  }
}

const GIT_STATUSES = new Set([
  'added',
  'conflicted',
  'deleted',
  'ignored',
  'modified',
  'renamed',
  'unmodified',
  'untracked',
])

/**
 * Validated, not cast, for the same reason as the status and the object ids beside it:
 * an arbitrary URL segment must not become a typed id. `parseSessionToken` already
 * applies this shape check to `t/` tokens; without it here a hand-edited `k/` token
 * minted a checkpoint document for a session that cannot exist, and the resulting tab
 * persisted into the cache.
 */
function sessionIdOrNull(sessionId: string | null) {
  const parsed = v.safeParse(sessionIdSchema, sessionId)
  return parsed.success ? parsed.output : null
}

/** Validated, not cast: an arbitrary URL string must not become a typed git status. */
function gitStatusOrUndefined(status: string | undefined) {
  if (!status || !GIT_STATUSES.has(status)) return undefined

  return status as Parameters<typeof checkpointDiffDocumentId>[0]['status']
}

function objectIdOrUndefined(value: string) {
  return OBJECT_ID.test(value) ? value.toLowerCase() : undefined
}

function relativeOrNull(rootPath: string, path: string | undefined) {
  return path ? toWorkspaceRelative(rootPath, path) : null
}

function absoluteOrUndefined(rootPath: string, relative: string | undefined) {
  return relative ? (toWorkspaceAbsolute(rootPath, relative) ?? undefined) : undefined
}
