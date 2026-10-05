import {
  decodePath,
  encodePath,
  encodeSegment,
  decodeSegment,
} from '@workspace/client-core/address/path-token'
import { SETTINGS_DOCUMENT_TOKEN } from '@workspace/client-core/address/grammar'
import {
  editorReferenceForToken,
  editorReferenceForSnapshotTarget,
  snapshotTargetForReference,
  tokenForEditorReference,
} from '@workspace/client-core/address/references'
import { toWorkspaceAbsolute, toWorkspaceRelative } from '@workspace/client-core/files/path'
import { GIT_OBJECT_ID_PATTERN, isGitFileStatus, sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import {
  fileDocument,
  fileResource,
  filesystemPath,
  workspaceRoot,
} from '@/lib/documents/utils/identity'
import { documentTab, settingsTab } from '@/lib/documents/utils/tabs'
import type { GitComparison, GitChangeStatus, TabContent } from '@/lib/documents/utils/types'

export type DocumentTokenResult =
  /** An addressable document, as its token. */
  | { readonly kind: 'token'; readonly token: string }
  /** No token can encode this document; the encoder cannot leak it by accident. */
  | { readonly kind: 'unaddressable'; readonly reason: string }

export type ParsedDocumentToken =
  | { readonly kind: 'content'; readonly content: TabContent }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'rejected'; readonly reason: string }

const TURN_SCOPE_SUFFIX = '!turn'

export function documentTokenForContent(
  rootPath: string | null,
  content: TabContent,
): DocumentTokenResult {
  if (content.kind === 'settings') return { kind: 'token', token: SETTINGS_DOCUMENT_TOKEN }
  if (rootPath === null) return { kind: 'unaddressable', reason: 'document requires a workspace' }
  const document = content.document
  switch (document.kind) {
    case 'file':
      return relativeToken('f', rootPath, document.resource.path)
    case 'search':
      return searchToken(rootPath, document.root)
    case 'git-diff':
      return diffToken(rootPath, document.source)
    case 'git-ref':
      return relativeToken('r', rootPath, document.source.path, [
        encodeSegment(document.source.ref),
      ])
    case 'compare-saved':
      return relativeToken('c', rootPath, document.file.path)
    case 'history':
      return relativeToken('h', rootPath, document.file.path)
    case 'conflict':
      return { kind: 'unaddressable', reason: 'conflict documents are not addressable' }
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

export function contentForDocumentToken(
  rootPath: string | null,
  token: string,
): ParsedDocumentToken {
  if (!editorReferenceForToken(token)) {
    return { kind: 'rejected', reason: 'document token is malformed' }
  }
  if (token === SETTINGS_DOCUMENT_TOKEN) return { kind: 'content', content: settingsTab() }
  if (rootPath === null) return { kind: 'rejected', reason: 'document requires a workspace' }

  const segments = token.split('/')
  const kind = segments[0]

  if (kind === 's')
    return {
      kind: 'content',
      content: documentTab({ kind: 'search', root: workspaceRoot(rootPath) }),
    }
  if (kind === 'f') return fileContent(rootPath, segments.slice(1))
  if (kind === 'c') return compareSavedContent(rootPath, segments.slice(1))
  if (kind === 'h') return historyContent(rootPath, segments.slice(1))
  if (kind === 'r') return refContent(rootPath, segments.slice(1))
  if (kind === 'd') return snapshotDiffContent(rootPath, segments.slice(1))
  if (kind === 'k') return checkpointDiffContent(rootPath, segments.slice(1))

  return { kind: 'rejected', reason: `unknown document token \`${kind ?? ''}\`` }
}

function searchToken(rootPath: string, searchRootPath: string): DocumentTokenResult {
  // The encoded absolute root disappears: the workspace is already in the path.
  if (searchRootPath !== rootPath) {
    return { kind: 'unaddressable', reason: 'search buffer belongs to another workspace' }
  }

  return { kind: 'token', token: 's' }
}

function diffToken(rootPath: string, source: GitComparison): DocumentTokenResult {
  if (source.kind === 'snapshot') {
    if (source.target.rootPath !== rootPath)
      return { kind: 'unaddressable', reason: 'diff belongs to another workspace' }
    const reference = editorReferenceForSnapshotTarget(source.target)
    return reference
      ? { kind: 'token', token: tokenForEditorReference(reference) }
      : { kind: 'unaddressable', reason: 'diff is outside this workspace' }
  }
  if (source.owner !== rootPath)
    return { kind: 'unaddressable', reason: 'checkpoint belongs to another workspace' }
  const extras =
    `,w=${source.ignoreWhitespace ? 1 : 0}` +
    tokenExtras({
      newObjectId: source.newObjectId,
      oldObjectId: source.oldObjectId,
      oldPath: relativeOrNull(rootPath, source.oldPath),
      status: source.status,
    })
  const head = `k/${encodeSegment(source.sessionId)}/${source.fromTurnCount}..${source.toTurnCount}${extras}`
  if (source.kind === 'checkpoint-session') return { kind: 'token', token: head }
  if (source.kind === 'checkpoint-turn')
    return { kind: 'token', token: `${head}${TURN_SCOPE_SUFFIX}` }
  const relative = toWorkspaceRelative(rootPath, source.file.path)
  if (!relative)
    return { kind: 'unaddressable', reason: 'checkpoint file is outside this workspace' }
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

function fileContent(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const path = decodePath(rootPath, segments)
  if (path === null) return { kind: 'rejected', reason: 'file token names no path' }
  return { kind: 'content', content: documentTab(fileDocument(fileResource(filesystemPath(path)))) }
}

function compareSavedContent(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const path = decodePath(rootPath, segments)
  if (!path) return { kind: 'rejected', reason: 'compare token names no path' }
  return {
    kind: 'content',
    content: documentTab({ kind: 'compare-saved', file: fileResource(filesystemPath(path)) }),
  }
}

function historyContent(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const path = decodePath(rootPath, segments)
  if (!path) return { kind: 'rejected', reason: 'history token names no path' }
  return {
    kind: 'content',
    content: documentTab({ kind: 'history', file: fileResource(filesystemPath(path)) }),
  }
}

function refContent(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const ref = decodeSegment(segments[0])
  const path = decodePath(rootPath, segments.slice(1))
  if (!ref || !path) return { kind: 'rejected', reason: 'ref token needs a ref and a path' }
  return {
    kind: 'content',
    content: documentTab({ kind: 'git-ref', source: { path: filesystemPath(path), ref } }),
  }
}

function snapshotDiffContent(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const reference = editorReferenceForToken(`d/${segments.join('/')}`)
  if (reference?.kind !== 'snapshot') return { kind: 'rejected', reason: 'diff token is malformed' }
  const parsed = snapshotTargetForReference(reference, rootPath)
  if (!parsed) return { kind: 'rejected', reason: 'diff token is malformed' }
  const paths = { rootPath: workspaceRoot(parsed.rootPath), path: filesystemPath(parsed.path) }
  const target =
    parsed.kind === 'moving'
      ? { ...parsed, ...paths }
      : {
          ...parsed,
          ...paths,
          revision: { ...parsed.revision, oldPath: filesystemPath(parsed.revision.oldPath) },
        }
  return {
    kind: 'content',
    content: documentTab({ kind: 'git-diff', source: { kind: 'snapshot', target } }),
  }
}

function checkpointDiffContent(rootPath: string, segments: readonly string[]): ParsedDocumentToken {
  const sessionId = sessionIdOrNull(decodeSegment(segments[0]))
  const turnSegment = segments[1] ?? ''
  const isTurnScope = turnSegment.endsWith(TURN_SCOPE_SUFFIX)
  const turns = parseTurnRange(
    isTurnScope ? turnSegment.slice(0, -TURN_SCOPE_SUFFIX.length) : turnSegment,
  )
  if (!sessionId || !turns)
    return { kind: 'rejected', reason: 'checkpoint token needs a session id and a turn range' }

  const filePath = segments.length > 2 ? decodePath(rootPath, segments.slice(2)) : null
  if (segments.length > 2 && filePath === null)
    return { kind: 'rejected', reason: 'checkpoint file is outside this workspace' }
  const range = {
    owner: workspaceRoot(rootPath),
    ignoreWhitespace: turns.ignoreWhitespace,
    fromTurnCount: turns.from,
    newObjectId: turns.newObjectId,
    oldObjectId: turns.oldObjectId,
    oldPath: absoluteOrUndefined(rootPath, turns.oldPath),
    status: gitStatusOrUndefined(turns.status),
    sessionId,
    toTurnCount: turns.to,
  }
  let source: GitComparison
  if (filePath !== null)
    source = { ...range, kind: 'checkpoint-file', file: fileResource(filesystemPath(filePath)) }
  else if (isTurnScope) source = { ...range, kind: 'checkpoint-turn' }
  else source = { ...range, kind: 'checkpoint-session' }
  return { kind: 'content', content: documentTab({ kind: 'git-diff', source }) }
}

function parseTurnRange(segment: string) {
  const [range, ...extras] = segment.split(',')
  if (extras.filter((extra) => extra.startsWith('w=')).length !== 1) return null
  const [fromRaw, toRaw] = range.split('..')
  const from = Number(fromRaw)
  const to = Number(toRaw)
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null
  if (from < 0 || to < from) return null

  const metadata = parseExtras(extras)
  if (metadata.ignoreWhitespace === undefined) return null
  return { from, to, ...metadata, ignoreWhitespace: metadata.ignoreWhitespace }
}

function parseExtras(extras: readonly string[]) {
  const byKey = new Map(
    extras.map((extra) => {
      const index = extra.indexOf('=')
      return index < 0 ? ['', ''] : [extra.slice(0, index), decodeSegment(extra.slice(index + 1))]
    }),
  )

  return {
    ignoreWhitespace: whitespacePolicy(byKey.get('w')),
    // Validated, not trusted: an arbitrary URL string must not become a git object id.
    newObjectId: objectIdOrUndefined(byKey.get('n') ?? ''),
    oldObjectId: objectIdOrUndefined(byKey.get('o') ?? ''),
    oldPath: byKey.get('r') ?? undefined,
    status: byKey.get('s') ?? undefined,
  }
}

function sessionIdOrNull(sessionId: string | null) {
  const parsed = v.safeParse(sessionIdSchema, sessionId)
  return parsed.success ? parsed.output : null
}

/** Validated, not cast: an arbitrary URL string must not become a typed git status. */
function gitStatusOrUndefined(status: string | undefined): GitChangeStatus | undefined {
  return status !== undefined && isGitFileStatus(status) ? status : undefined
}

function objectIdOrUndefined(value: string) {
  return GIT_OBJECT_ID_PATTERN.test(value) ? value.toLowerCase() : undefined
}

function relativeOrNull(rootPath: string, path: string | undefined) {
  return path ? toWorkspaceRelative(rootPath, path) : null
}

function absoluteOrUndefined(rootPath: string, relative: string | undefined) {
  if (!relative) return undefined
  const path = toWorkspaceAbsolute(rootPath, relative)
  return path === null ? undefined : filesystemPath(path)
}

function whitespacePolicy(value: string | null | undefined): boolean | undefined {
  if (value === '0') return false
  if (value === '1') return true
  return undefined
}
