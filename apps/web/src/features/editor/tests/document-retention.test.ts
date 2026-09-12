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
    projectLimit: 3,
    slices: [slice('/repo', 200, [shared]), slice('/repo/apps/web', 100, [shared])],
  })

  // Counting the shared document twice would blow the budget and drop the nested
  // root, taking a document the active root still displays with it.
  expect(retention.documentKeys.has(testDocumentKey(shared))).toBe(true)
  expect(retention.tabIds.size).toBe(2)
})
