import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { testDocumentKey } from '../../../../test/factories/document-targets'
import { retentionForProjects } from '@/features/editor/utils/document-retention'
import { expect, test } from '../../../../test/fixtures'

function slice(rootPath: string, lastActiveAt: number, documentKeys: readonly string[]) {
  return {
    documentKeys: documentKeys.map((path) => testDocumentKey(path)),
    lastActiveAt,
    rootPath: filesystemPath(rootPath),
    // Tab ids are unique per tab, so the same file open in two roots is two tabs.
    tabIds: documentKeys.map((id) => tabId(`tab:${rootPath}:${id}`)),
  }
}

const slices = [
  slice('/repo/a', 300, ['/repo/a/one.ts']),
  slice('/repo/b', 200, ['/repo/b/one.ts']),
  slice('/repo/c', 100, ['/repo/c/one.ts']),
  slice('/repo/d', 50, ['/repo/d/one.ts']),
]

test('keeps the active project plus the most recent others, trimming the oldest', () => {
  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/repo/a'),
    byteBudget: Number.MAX_SAFE_INTEGER,
    documentSizes: new Map(),
    unevictableDocumentKeys: new Set(),
    projectLimit: 3,
    slices,
  })

  expect([...retention.documentKeys].toSorted()).toEqual(
    ['/repo/a/one.ts', '/repo/b/one.ts', '/repo/c/one.ts'].map((path) => testDocumentKey(path)),
  )
  expect(retention.tabIds.has(tabId('tab:/repo/a:/repo/a/one.ts'))).toBe(true)
})

test('never trims the active project, however stale it is', () => {
  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/repo/d'),
    byteBudget: Number.MAX_SAFE_INTEGER,
    documentSizes: new Map(),
    unevictableDocumentKeys: new Set(),
    projectLimit: 2,
    slices,
  })

  expect(retention.documentKeys.has(testDocumentKey('/repo/d/one.ts'))).toBe(true)
  expect(retention.documentKeys.size).toBe(2)
})

test('a byte budget trims a project that the count alone would have kept', () => {
  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/repo/a'),
    byteBudget: 150,
    documentSizes: new Map([
      [testDocumentKey('/repo/a/one.ts'), 100],
      [testDocumentKey('/repo/b/one.ts'), 40],
      [testDocumentKey('/repo/c/one.ts'), 100],
    ]),
    unevictableDocumentKeys: new Set(),
    projectLimit: 3,
    slices,
  })

  expect(retention.documentKeys.has(testDocumentKey('/repo/a/one.ts'))).toBe(true)
  expect(retention.documentKeys.has(testDocumentKey('/repo/b/one.ts'))).toBe(true)
  // Inside the project limit, but 100 + 40 + 100 overruns the 150-byte budget.
  expect(retention.documentKeys.has(testDocumentKey('/repo/c/one.ts'))).toBe(false)
})

test('charges a document shared by nested roots only once', () => {
  const shared = '/repo/shared.ts'
  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/repo'),
    byteBudget: 100,
    documentSizes: new Map([[testDocumentKey(shared), 100]]),
    unevictableDocumentKeys: new Set(),
    projectLimit: 3,
    slices: [slice('/repo', 200, [shared]), slice('/repo/apps/web', 100, [shared])],
  })

  // Counting the shared document twice would blow the budget and drop the nested
  // root, taking a document the active root still displays with it.
  expect(retention.documentKeys.has(testDocumentKey(shared))).toBe(true)
  expect(retention.tabIds.size).toBe(2)
})

// The budget is chosen so measure-then-commit and commit-while-measuring
// disagree. At a looser one both keep the late slice and this proves nothing.
test('a rejected project does not pay for the documents a later project shares', () => {
  const shared = '/repo/shared.ts'
  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/repo/active'),
    byteBudget: 100,
    documentSizes: new Map([
      [testDocumentKey('/repo/active/one.ts'), 10],
      [testDocumentKey('/repo/big/one.ts'), 100],
      [testDocumentKey(shared), 100],
    ]),
    unevictableDocumentKeys: new Set(),
    projectLimit: 3,
    slices: [
      slice('/repo/active', 400, ['/repo/active/one.ts']),
      // Rejected: 10 + 100 + 100 overruns 100.
      slice('/repo/big', 300, ['/repo/big/one.ts', shared]),
      // Also rejected: `shared` is uncharged, so this costs its full 100 on top
      // of the active 10.
      slice('/repo/late', 200, [shared]),
    ],
  })

  expect(retention.documentKeys.has(testDocumentKey('/repo/active/one.ts'))).toBe(true)
  expect(retention.documentKeys.has(testDocumentKey('/repo/big/one.ts'))).toBe(false)
  expect(retention.documentKeys.has(testDocumentKey(shared))).toBe(false)
})

test('charges a document listed twice in one slice only once', () => {
  const duplicate = testDocumentKey('/repo/dup.ts')
  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/repo/a'),
    byteBudget: 100,
    documentSizes: new Map([[duplicate, 100]]),
    unevictableDocumentKeys: new Set(),
    projectLimit: 3,
    slices: [
      slice('/repo/a', 200, ['/repo/a/one.ts']),
      { ...slice('/repo/b', 100, ['/repo/dup.ts']), documentKeys: [duplicate, duplicate] },
    ],
  })

  // Double-charging would cost 200 against a 100 budget and drop a document the
  // tab still displays.
  expect(retention.documentKeys.has(duplicate)).toBe(true)
})

test('retains the rootless active slice, which has no root path to match', () => {
  const rootless = testDocumentKey('/repo/rootless.ts')
  const retention = retentionForProjects({
    activeRootPath: null,
    byteBudget: 10,
    documentSizes: new Map([[rootless, 1_000]]),
    unevictableDocumentKeys: new Set(),
    projectLimit: 3,
    slices: [
      slice('/repo/parked', 100, ['/repo/parked/one.ts']),
      { ...slice('/repo/x', 200, ['/repo/rootless.ts']), rootPath: null },
    ],
  })

  // The active slice is never trimmed, even over budget and even with no root.
  expect(retention.documentKeys.has(rootless)).toBe(true)
})

// `retain` keeps dirty, non-`file` and unreachable documents whatever the keep set
// says, so their text is unavoidable. Charging it only when their slice happens to
// be admitted let optional parked text be admitted on top of it: this case used to
// keep the clean 800 beside an unevictable 800 against a 1,000 budget, leaving
// 1,600 resident the moment the trim finished.
test('charges unevictable text before admitting an optional parked project', () => {
  const dirty = testDocumentKey('/repo/dirty/one.ts')
  const clean = testDocumentKey('/repo/clean/one.ts')
  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/repo/active'),
    byteBudget: 1_000,
    documentSizes: new Map([
      [dirty, 800],
      [clean, 800],
    ]),
    unevictableDocumentKeys: new Set([dirty]),
    projectLimit: 3,
    slices: [
      slice('/repo/active', 400, []),
      slice('/repo/clean', 300, ['/repo/clean/one.ts']),
      slice('/repo/dirty', 200, ['/repo/dirty/one.ts']),
    ],
  })

  // The dirty slice is still retained — its document cannot be evicted, so keeping
  // its tab costs nothing — but the clean 800 no longer fits beside it.
  expect(retention.documentKeys.has(dirty)).toBe(true)
  expect(retention.documentKeys.has(clean)).toBe(false)
})

test('keeps an unevictable document from being charged twice over', () => {
  const dirty = testDocumentKey('/repo/dirty/one.ts')
  const retention = retentionForProjects({
    activeRootPath: filesystemPath('/repo/active'),
    byteBudget: 900,
    documentSizes: new Map([[dirty, 800]]),
    unevictableDocumentKeys: new Set([dirty]),
    projectLimit: 3,
    slices: [
      slice('/repo/active', 400, ['/repo/dirty/one.ts']),
      slice('/repo/dirty', 200, ['/repo/dirty/one.ts']),
    ],
  })

  // Charged once at 800, not 1,600: the active slice and the parked slice name the
  // same document, and it is already in the unevictable floor.
  expect(retention.documentKeys.has(dirty)).toBe(true)
  expect(retention.tabIds.size).toBe(2)
})
