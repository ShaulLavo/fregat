import { expect, test } from '../../../../../test/fixtures'
import type { GitComparison } from '@/lib/documents/utils/types'
import { filesystemPath } from '@/lib/documents/utils/identity'
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
  status?: GitComparison['status']
}): GitComparison {
  return {
    kind: 'snapshot',
    path: filesystemPath(`${ROOT}/src/new-name.ts`),
    oldPath: oldPath === undefined ? undefined : filesystemPath(oldPath),
    status,
  }
}
