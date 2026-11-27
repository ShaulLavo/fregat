import { FileTreeModel } from '@shaulavo/workbench-tree'

import { preparedTreeInputForPaths } from '@/features/workspace/state/prepared-tree-input-cache'

import { expect, test } from '../../../../test/fixtures'

test('reuses prepared input only for the exact path-array identity', () => {
  const paths = ['src/', 'src/a.ts'] as const
  const sameIdentity = preparedTreeInputForPaths(paths)

  expect(preparedTreeInputForPaths(paths)).toBe(sameIdentity)
  expect(preparedTreeInputForPaths([...paths])).not.toBe(sameIdentity)
})

test('uses a matching prepared path set for construction and replacement', () => {
  const initialPaths = ['src/', 'src/a.ts'] as const
  const initialPreparedInput = preparedTreeInputForPaths(initialPaths)
  const tree = new FileTreeModel({ preparedInput: initialPreparedInput })

  const nextPaths = ['README.md', 'src/', 'src/b.ts'] as const
  const nextPreparedInput = preparedTreeInputForPaths(nextPaths)
  tree.replacePreparedInput(nextPreparedInput)

  expect(tree.index.getKind('src/a.ts')).toBeUndefined()
  expect(tree.index.getKind('src/b.ts')).toBe('file')
  expect(tree.index.getKind('README.md')).toBe('file')
})
