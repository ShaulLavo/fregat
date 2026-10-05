import { expect, test } from '../../../../../test/fixtures'
import { snapshotTarget } from '../../../../../test/factories/git-diff'
import type { GitComparison, GitChangeStatus } from '@/lib/documents/utils/types'
import { emptyDiffNotice } from '../diff-presentation'

const ROOT = '/repo/platform'

test('a rename with no content change says where the file came from', () => {
  const info = documentInfo({ oldPath: `${ROOT}/src/old-name.ts` })

  expect(emptyDiffNotice(info, ROOT)).toBe('Renamed from src/old-name.ts. No content changes.')
})

test('a renamed status with no old path still reads as a rename', () => {
  const info = documentInfo({ status: 'renamed' })

  expect(emptyDiffNotice(info, ROOT)).toBe('Renamed. No content changes.')
})

test('an ordinary empty diff falls back to a plain message', () => {
  expect(emptyDiffNotice(documentInfo({}), ROOT)).toBe('No changes to show.')
})

function documentInfo({
  oldPath,
  status,
}: {
  oldPath?: string
  status?: GitChangeStatus
}): GitComparison {
  return snapshotTarget({
    kind: 'captured-review',
    rootPath: ROOT,
    path: `${ROOT}/src/new-name.ts`,
    revision: {
      old: { kind: 'blob', objectId: 'a'.repeat(40) },
      new: { kind: 'blob', objectId: 'b'.repeat(40) },
      oldPath: oldPath ?? `${ROOT}/src/new-name.ts`,
      status: status ?? 'modified',
    },
  })
}
