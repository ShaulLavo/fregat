import { createClientInvariantError } from '@/lib/structured-errors'
import { expect, test } from '../../../../test/fixtures'
import {
  documentTargets,
  testDocumentRef,
  testTabContent,
} from '../../../../test/factories/document-targets'
import { decodeDocumentTarget, encodedViewTarget } from '@/lib/documents/utils/codec'
import { filesystemPath, conflictId } from '@/lib/documents/utils/identity'
import {
  documentLabel,
  documentTitle,
  comparisonShortHash,
  tabPalettePresentation,
} from '@/lib/documents/utils/labels'
import { comparisonRequest } from '@/lib/documents/utils/comparisons'

const root = filesystemPath('/repo')

test.each(
  Object.entries(documentTargets).filter(
    ([name]) => !['settings', 'file', 'relativeFile'].includes(name),
  ),
)('round-trips the characterized %s target through its boundary format', (_, raw) => {
  const document = testDocumentRef(raw)
  if (document.kind === 'file') throw createClientInvariantError('View fixture must not be a file')
  expect(decodeDocumentTarget(encodedViewTarget(document), root)).toEqual({
    kind: 'tab',
    content: { kind: 'document', document },
  })
})

test('reference paths and refs preserve colons and slashes', () => {
  const document = {
    kind: 'git-ref',
    source: { path: filesystemPath('src/a:b.ts'), ref: 'refs/heads/feat:x' },
  } as const
  expect(decodeDocumentTarget(encodedViewTarget(document), root)).toEqual({
    kind: 'tab',
    content: { kind: 'document', document },
  })
  expect(documentLabel(document)).toBe('a:b.ts (refs/heads/feat:x)')
})

test('compare paths preserve spaces, URL punctuation and their working-tree label', () => {
  const document = {
    kind: 'compare-saved',
    file: { path: filesystemPath('src/a b/c#d?e.ts') },
  } as const
  expect(decodeDocumentTarget(encodedViewTarget(document), root)).toEqual({
    kind: 'tab',
    content: { kind: 'document', document },
  })
  expect(documentLabel(document)).toBe('c#d?e.ts (working tree)')
})

test('conflict targets carry only the record identity and use explicit presentation facts', () => {
  const document = { kind: 'conflict', conflictId: conflictId('conflict/1:changed') } as const
  const encoded = encodedViewTarget(document)
  expect(encoded).toBe('conflict-diff:conflict%2F1%3Achanged')
  expect(decodeDocumentTarget(encoded, root)).toEqual({
    kind: 'tab',
    content: { kind: 'document', document },
  })
  expect(documentLabel(document, { conflictPath: '/repo/src/app.ts' })).toBe('app.ts')
  expect(documentTitle(document, { conflictPath: '/repo/src/app.ts' })).toBe(
    '/repo/src/app.ts conflict editor',
  )
})

test('comparison requests retain snapshot revisions and the checkpoint query adapter', () => {
  const snapshot = testDocumentRef(documentTargets.snapshot)
  const checkpoint = testDocumentRef(documentTargets.checkpointFile)
  if (snapshot.kind !== 'git-diff' || checkpoint.kind !== 'git-diff')
    throw createClientInvariantError('Invalid fixture')
  expect(comparisonRequest(snapshot.source)).toEqual({
    kind: 'snapshot',
    query: {
      path: '/repo/src/a.ts',
      oldPath: '/repo/src/old.ts',
      oldObjectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      newObjectId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  })
  expect(comparisonShortHash(snapshot.source)).toBe('bbbbbbb')
  expect(comparisonRequest(checkpoint.source)).toMatchObject({
    kind: 'checkpoint',
    query: {
      path: '/repo/src/a.ts',
      filePath: '/repo/src/a.ts',
      oldPath: '/repo/src/old.ts',
      fromTurnCount: 1,
      toTurnCount: 2,
      scope: 'file',
      status: 'renamed',
    },
  })
})

test('palette fallback labels stay separate from tab-strip presentation', () => {
  expect(tabPalettePresentation(testTabContent(documentTargets.settings))).toEqual({
    name: 'settings:',
    pathLabel: '/settings:',
  })
  expect(tabPalettePresentation(testTabContent(documentTargets.conflict))).toEqual({
    name: 'conflict-diff:conflict-1',
    pathLabel: '/conflict-diff:conflict-1',
  })
  expect(tabPalettePresentation(testTabContent(documentTargets.relativeFile))).toEqual({
    name: 'a.ts',
    pathLabel: '/src/a.ts',
  })
  expect(tabPalettePresentation(testTabContent(documentTargets.search))).toEqual({
    name: 'Search',
    pathLabel: '/repo search results',
  })
})
