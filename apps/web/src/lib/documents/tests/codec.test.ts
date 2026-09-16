import { createClientInvariantError } from '@/lib/structured-errors'
import { expect, test } from '../../../../test/fixtures'
import {
  documentTargets,
  testDocumentRef,
  testTabContent,
} from '../../../../test/factories/document-targets'
import { encodedViewTarget } from '@/lib/documents/utils/codec'
import { filesystemPath, conflictId } from '@/lib/documents/utils/identity'
import {
  documentLabel,
  documentTitle,
  comparisonShortHash,
  tabPalettePresentation,
} from '@/lib/documents/utils/labels'
import { comparisonRequest } from '@/lib/documents/utils/comparisons'

const viewTargets = Object.entries(documentTargets).filter(
  ([name]) => !['settings', 'file', 'relativeFile'].includes(name),
)

// This string is the language-server URI for a document with no file of its own, so two
// documents sharing one would hand the server a single view of both.
test('every characterized view target encodes to its own identity', () => {
  const encoded = viewTargets.map(([, raw]) => {
    const document = testDocumentRef(raw)
    if (document.kind === 'file')
      throw createClientInvariantError('View fixture must not be a file')
    return encodedViewTarget(document)
  })
  expect(new Set(encoded).size).toBe(encoded.length)
})

test('view identities escape the punctuation a URI cannot carry raw', () => {
  const reference = {
    kind: 'git-ref',
    source: { path: filesystemPath('src/a:b.ts'), ref: 'refs/heads/feat:x' },
  } as const
  const compared = {
    kind: 'compare-saved',
    file: { path: filesystemPath('src/a b/c#d?e.ts') },
  } as const
  const history = { kind: 'history', file: { path: filesystemPath('src/a b/c#d?e.ts') } } as const
  expect(encodedViewTarget(reference)).not.toMatch(/[\s#?]/)
  expect(encodedViewTarget(compared)).not.toMatch(/[\s#?]/)
  expect(encodedViewTarget(history)).not.toMatch(/[\s#?]/)
  expect(documentLabel(reference)).toBe('a:b.ts (refs/heads/feat:x)')
  expect(documentLabel(compared)).toBe('c#d?e.ts (working tree)')
  expect(documentLabel(history)).toBe('c#d?e.ts (history)')
})

test('conflict targets are keyed by the record identity and presented by their path', () => {
  const document = {
    kind: 'conflict',
    conflictId: conflictId('conflict/1:changed'),
    path: filesystemPath('/repo/src/app.ts'),
  } as const
  expect(encodedViewTarget(document)).toBe('conflict-diff:conflict%2F1%3Achanged')
  expect(documentLabel(document)).toBe('app.ts')
  expect(documentTitle(document)).toBe('/repo/src/app.ts: Current Changes ↔ Incoming Changes')
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
    name: 'a.ts',
    pathLabel: '//repo/src/a.ts',
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
