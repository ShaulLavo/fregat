import { decodeDocumentTarget } from './document-target-codec'
import { documentKey, workspaceRoot } from '@/lib/documents/utils/identity'
import { sameTabContent } from '@/lib/documents/utils/tabs'
import type { DocumentRef, ReopenScrollPosition, TabContent } from '@/lib/documents/utils/types'
import { createClientError } from '@workspace/client-core/errors'
import { TEST_SESSION_ID } from './chat'

export const DOCUMENT_OLD_OBJECT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export const DOCUMENT_NEW_OBJECT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

export const documentTargets = {
  file: '/repo/src/a.ts',
  relativeFile: 'src/a.ts',
  settings: 'settings:',
  conflict: 'conflict-diff:conflict-1',
  reference: encodedTarget('git-ref:', {
    path: '/repo/src/a.ts',
    ref: 'refs/heads/main',
    version: 1,
  }),
  savedComparison: 'compare-saved:%2Frepo%2Fsrc%2Fa.ts',
  snapshot: encodedTarget('git-diff:v2:', {
    newObjectId: DOCUMENT_NEW_OBJECT_ID,
    oldObjectId: DOCUMENT_OLD_OBJECT_ID,
    oldPath: '/repo/src/old.ts',
    path: '/repo/src/a.ts',
    source: 'worktree',
    status: 'renamed',
    version: 2,
  }),
  checkpointFile: encodedTarget('git-diff:checkpoint-v1:', {
    filePath: '/repo/src/a.ts',
    fromTurnCount: 1,
    newObjectId: DOCUMENT_NEW_OBJECT_ID,
    oldObjectId: DOCUMENT_OLD_OBJECT_ID,
    oldPath: '/repo/src/old.ts',
    path: '/repo/src/a.ts',
    scope: 'file',
    status: 'renamed',
    sessionId: TEST_SESSION_ID,
    toTurnCount: 2,
    version: 1,
  }),
  checkpointSession: encodedTarget('git-diff:checkpoint-v1:', {
    fromTurnCount: 0,
    path: 'checkpoint-session-2',
    scope: 'session',
    sessionId: TEST_SESSION_ID,
    toTurnCount: 2,
    version: 1,
  }),
  checkpointTurn: encodedTarget('git-diff:checkpoint-v1:', {
    fromTurnCount: 1,
    path: 'checkpoint-turn-2',
    scope: 'turn',
    sessionId: TEST_SESSION_ID,
    toTurnCount: 2,
    version: 1,
  }),
  search: 'search-buffer:%2Frepo',
  emptyRootSearch: 'search-buffer:',
}

export function testTabContent(path: string, owner = '/repo'): TabContent {
  const decoded = decodeDocumentTarget(path, workspaceRoot(owner))
  if (decoded.kind !== 'tab')
    throw createClientError({
      message: `Invalid test tab content: ${path}`,
      code: 'INVALID_TEST_TAB',
      status: 500,
      why: 'The fixture does not decode to a tab.',
      fix: 'Use a valid document target fixture.',
    })
  return decoded.content
}

export function testTabContents(paths: readonly string[], owner = '/repo'): readonly TabContent[] {
  return paths.map((path) => testTabContent(path, owner))
}

export function testNullableTabContent(
  path: string | null | undefined,
  owner = '/repo',
): TabContent | null {
  return path == null ? null : testTabContent(path, owner)
}

export function testContentMatches(
  content: TabContent | null,
  path: string,
  owner = '/repo',
): boolean {
  return content !== null && sameTabContent(content, testTabContent(path, owner))
}

export function testDocumentRef(path: string, owner = '/repo'): DocumentRef {
  const decoded = decodeDocumentTarget(path, workspaceRoot(owner))
  if (decoded.kind === 'internal') return decoded.document
  if (decoded.kind === 'tab' && decoded.content.kind === 'document') return decoded.content.document
  throw createClientError({
    message: `Invalid test document: ${path}`,
    code: 'INVALID_TEST_DOCUMENT',
    status: 500,
    why: 'The fixture does not decode to a document.',
    fix: 'Use a valid document target fixture.',
  })
}

export function testDocumentKey(path: string, owner = '/repo') {
  return documentKey(testDocumentRef(path, owner))
}

export function testScrollPositions(
  positions: Readonly<Record<string, ReopenScrollPosition['position']>>,
  owner = '/repo',
): readonly ReopenScrollPosition[] {
  return Object.entries(positions).map(([path, position]) => ({
    content: testTabContent(path, owner),
    position,
  }))
}

function encodedTarget(prefix: string, payload: unknown): string {
  return `${prefix}${encodeURIComponent(JSON.stringify(payload))}`
}

type DocumentTargetCase = {
  readonly kind: keyof typeof documentTargets
  readonly rootPath: string
  readonly path: string
  readonly filePath: string | null
  readonly name: string
  readonly title: string
  readonly copyPath: string
  readonly copyRelativePath: string
  readonly diffSource: {
    readonly onDisk: boolean
    readonly path: string
  } | null
  readonly token: string | null
}

export const DOCUMENT_TARGET_CASES: readonly DocumentTargetCase[] = [
  {
    kind: 'file',
    rootPath: '/repo',
    path: documentTargets.file,
    filePath: '/repo/src/a.ts',
    name: 'a.ts',
    title: '//repo/src/a.ts',
    copyPath: '/repo/src/a.ts',
    copyRelativePath: 'src/a.ts',
    diffSource: null,
    token: 'f/src/a.ts',
  },
  {
    kind: 'relativeFile',
    rootPath: '',
    path: documentTargets.relativeFile,
    filePath: 'src/a.ts',
    name: 'a.ts',
    title: '/src/a.ts',
    copyPath: 'src/a.ts',
    copyRelativePath: 'src/a.ts',
    diffSource: null,
    token: 'f/src/a.ts',
  },
  {
    kind: 'settings',
    rootPath: '/repo',
    path: documentTargets.settings,
    filePath: null,
    name: 'settings.json',
    title: '/settings:',
    copyPath: 'settings:',
    copyRelativePath: 'settings:',
    diffSource: null,
    token: 'settings',
  },
  {
    kind: 'conflict',
    rootPath: '/repo',
    path: documentTargets.conflict,
    filePath: null,
    name: 'a.ts',
    title: '/repo/src/a.ts: Current Changes ↔ Incoming Changes',
    copyPath: '/repo/src/a.ts',
    copyRelativePath: 'src/a.ts',
    diffSource: null,
    token: null,
  },
  {
    kind: 'reference',
    rootPath: '/repo',
    path: documentTargets.reference,
    filePath: null,
    name: 'a.ts (refs/heads/main)',
    title: '//repo/src/a.ts at refs/heads/main',
    copyPath: '/repo/src/a.ts',
    copyRelativePath: 'src/a.ts',
    diffSource: null,
    token: 'r/refs%2Fheads%2Fmain/src/a.ts',
  },
  {
    kind: 'savedComparison',
    rootPath: '/repo',
    path: documentTargets.savedComparison,
    filePath: null,
    name: 'a.ts (working tree)',
    title: '//repo/src/a.ts — working tree vs saved',
    copyPath: '/repo/src/a.ts',
    copyRelativePath: 'src/a.ts',
    diffSource: null,
    token: 'c/src/a.ts',
  },
  {
    kind: 'snapshot',
    rootPath: '/repo',
    path: documentTargets.snapshot,
    filePath: null,
    name: 'a.ts',
    title: '/repo/src/a.ts diff at bbbbbbb',
    copyPath: '/repo/src/a.ts',
    copyRelativePath: 'src/a.ts',
    diffSource: { onDisk: true, path: '/repo/src/a.ts' },
    token: `d/worktree/${DOCUMENT_OLD_OBJECT_ID}..${DOCUMENT_NEW_OBJECT_ID},s=renamed,r=src%2Fold.ts/src/a.ts`,
  },
  {
    kind: 'checkpointFile',
    rootPath: '/repo',
    path: documentTargets.checkpointFile,
    filePath: null,
    name: 'a.ts',
    title: '/repo/src/a.ts checkpoint diff 1-2',
    copyPath: '/repo/src/a.ts',
    copyRelativePath: 'src/a.ts',
    diffSource: { onDisk: true, path: '/repo/src/a.ts' },
    token: `k/${TEST_SESSION_ID}/1..2,s=renamed,r=src%2Fold.ts,o=${DOCUMENT_OLD_OBJECT_ID},n=${DOCUMENT_NEW_OBJECT_ID}/src/a.ts`,
  },
  {
    kind: 'checkpointSession',
    rootPath: '/repo',
    path: documentTargets.checkpointSession,
    filePath: null,
    name: 'Session diff 2',
    title: 'Session checkpoint diff 0-2',
    copyPath: 'checkpoint-session-2',
    copyRelativePath: 'checkpoint-session-2',
    diffSource: null,
    token: `k/${TEST_SESSION_ID}/0..2`,
  },
  {
    kind: 'checkpointTurn',
    rootPath: '/repo',
    path: documentTargets.checkpointTurn,
    filePath: null,
    name: 'Turn diff 1-2',
    title: 'Turn checkpoint diff 1-2',
    copyPath: 'checkpoint-turn-2',
    copyRelativePath: 'checkpoint-turn-2',
    diffSource: null,
    token: `k/${TEST_SESSION_ID}/1..2!turn`,
  },
  {
    kind: 'search',
    rootPath: '/repo',
    path: documentTargets.search,
    filePath: null,
    name: 'Search',
    title: '/repo search results',
    copyPath: '/repo',
    copyRelativePath: 'repo',
    diffSource: null,
    token: 's',
  },
  {
    kind: 'emptyRootSearch',
    rootPath: '',
    path: documentTargets.emptyRootSearch,
    filePath: null,
    name: 'Search',
    title: '/ search results',
    copyPath: '',
    copyRelativePath: '',
    diffSource: null,
    token: 's',
  },
]

export const INVALID_DOCUMENT_IDS = [
  'git-diff:',
  'git-diff:%%%',
  'git-diff:v2:%%%',
  'git-diff:v2:%7B',
  'git-diff:v2:%7B%22path%22%3A%22a.ts%22%2C%22oldObjectId%22%3A%22aaaa%22%2C%22version%22%3A3%7D',
  'git-diff:checkpoint-v1:%7B%22version%22%3A2%7D',
  'git-ref:',
  'git-ref:%%%',
  'git-ref:not-json',
  'git-ref:%7B%22path%22%3A%22a.ts%22%2C%22ref%22%3A%22HEAD%22%2C%22version%22%3A2%7D',
  'conflict-diff:',
  'conflict-diff:%%%',
  'compare-saved:',
  'compare-saved:%%%',
  'search-buffer:%%%',
  'settings-json:',
  'settings-json:%%%',
  'settings-json:invalid',
] as const

export const INVALID_SETTINGS_SURFACE_IDS = ['settings:%%%', 'settings:invalid'] as const
export const INTERNAL_SETTINGS_DOCUMENT_IDS = [
  'settings-json:user',
  'settings-json:workspace',
] as const
