import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'
import { DOCUMENT_TARGET_CASES, testTabContent } from '../../../../test/factories/document-targets'
import { filesystemPath, tabId, workspaceRoot } from '@/lib/documents/utils/identity'
import {
  editorTabPrefetchRegistrationKey,
  editorTabFileOpenIntent,
  editorTabPrefetchTarget,
} from '@/features/workspace/utils/tab-prefetch'

describe('editor tab prefetch helpers', () => {
  it.each(DOCUMENT_TARGET_CASES)(
    'prefetches only the actual file in $kind',
    ({ path, filePath, rootPath }) => {
      const id = tabId('tab-prefetch')
      const tab = { id, content: testTabContent(path, rootPath) }
      const expected = filePath === null ? null : { id, path: filesystemPath(filePath) }
      expect(editorTabPrefetchTarget(tab)).toEqual(expected)
      if (expected === null) return
      expect(editorTabFileOpenIntent(workspaceRoot(rootPath), expected)).toEqual({
        path: filePath,
        rootPath,
        source: 'tab',
        tabId: id,
      })
    },
  )

  it('creates stable registration keys from tab ids and paths', () => {
    expect(
      editorTabPrefetchRegistrationKey({
        id: tabId('tab-a'),
        path: filesystemPath('/repo/src/app.ts'),
      }),
    ).toBe('tab-a:/repo/src/app.ts')
  })

  it('targets file-backed tabs for intent prefetching', () => {
    expect(
      editorTabPrefetchTarget({ id: tabId('tab-a'), content: testTabContent('/repo/src/app.ts') }),
    ).toEqual({ id: 'tab-a', path: '/repo/src/app.ts' })
  })

  it('creates the structured tab intent passed to the shared service', () => {
    expect(
      editorTabFileOpenIntent(workspaceRoot('/repo'), {
        id: tabId('tab-a'),
        path: filesystemPath('/repo/src/app.ts'),
      }),
    ).toEqual({ path: '/repo/src/app.ts', rootPath: '/repo', source: 'tab', tabId: 'tab-a' })
  })

  it('ignores the active file tab', () => {
    expect(
      editorTabPrefetchTarget({
        active: true,
        id: tabId('tab-a'),
        content: testTabContent('/repo/src/app.ts'),
      }),
    ).toBeNull()
  })
})
