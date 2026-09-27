import { TreeViewModel } from '@/features/workspace/state/tree-model'

import { preparedTreeInputForPaths } from '@/features/workspace/state/prepared-tree-input-cache'

import { expect, test } from '../../../../test/fixtures'

test('reuses prepared input only for the exact path-array identity', () => {
  const paths = ['src/', 'src/a.ts'] as const
  const sameIdentity = preparedTreeInputForPaths(paths)

  expect(preparedTreeInputForPaths(paths)).toBe(sameIdentity)
  expect(preparedTreeInputForPaths([...paths])).not.toBe(sameIdentity)
})

test('uses a matching prepared path set for construction and reset', () => {
  const initialPaths = ['src/', 'src/a.ts'] as const
  const initialPreparedInput = preparedTreeInputForPaths(initialPaths)
  const tree = new TreeViewModel({ preparedInput: initialPreparedInput })
  const events: unknown[] = []
  const unsubscribe = tree.onMutation('reset', (event) => events.push(event))

  try {
    const nextPaths = ['README.md', 'src/', 'src/b.ts'] as const
    const nextPreparedInput = preparedTreeInputForPaths(nextPaths)
    tree.resetPaths(nextPreparedInput.paths, { preparedInput: nextPreparedInput })

    expect(tree.getItem('src/a.ts')).toBeNull()
    expect(tree.getItem('src/b.ts')).not.toBeNull()
    expect(events).toEqual([
      expect.objectContaining({ operation: 'reset', usedPreparedInput: true }),
    ])
  } finally {
    unsubscribe()
    tree.cleanUp()
  }
})
