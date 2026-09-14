import { expect, test } from '../../../../test/fixtures'
import { historyCommit } from '../../../../test/factories/git-history'
import { layoutHistory, layoutHistoryMatches } from '@/features/git/utils/history-layout'

test('a linear history has one continuous lane ending at the root', () => {
  const rows = layoutHistory([
    historyCommit('c', ['b']),
    historyCommit('b', ['a']),
    historyCommit('a'),
  ])
  expect(rows.map((row) => row.column)).toEqual([0, 0, 0])
  expect(rows.map((row) => row.color)).toEqual([0, 0, 0])
  expect(rows[1]?.edges.map((edge) => edge.half)).toEqual(['top', 'bottom'])
  expect(rows[2]?.edges.map((edge) => edge.half)).toEqual(['top'])
})

test('merge parents split and join without dropping surviving lanes at a disconnected root', () => {
  const rows = layoutHistory([
    historyCommit('merge', ['main', 'side']),
    historyCommit('island'),
    historyCommit('main', ['base']),
    historyCommit('side', ['base']),
    historyCommit('base'),
  ])
  expect(rows[0]?.edges.map((edge) => [edge.to, edge.half])).toEqual([
    [0, 'bottom'],
    [1, 'bottom'],
  ])
  expect(rows[1]?.edges.map((edge) => [edge.from, edge.to, edge.half])).toEqual([
    [0, 0, 'full'],
    [1, 1, 'full'],
  ])
  expect(rows[3]?.edges).toContainEqual(expect.objectContaining({ from: 1, to: 0, half: 'bottom' }))
  expect(rows[4]?.width).toBe(1)
})

test('octopus merges preserve distinct parents and page appends never change earlier geometry', () => {
  const commits = [
    historyCommit('merge', ['one', 'two', 'three']),
    historyCommit('one', ['root']),
    historyCommit('two', ['root']),
    historyCommit('three', ['root']),
    historyCommit('root'),
  ]
  const rows = layoutHistory(commits)
  expect(rows[0]?.width).toBe(3)
  expect(rows[0]?.edges.map((edge) => edge.to)).toEqual([0, 1, 2])
  expect(rows.slice(0, 2)).toEqual(layoutHistory(commits.slice(0, 2)))
  expect(rows.every((row) => row.edges.every((edge) => edge.from >= 0 && edge.to >= 0))).toBe(true)
  expect(rows.at(-1)?.width).toBe(1)
})

test('an isolated or shallow root stops its own lane', () => {
  expect(layoutHistory([])).toEqual([])
  const rows = layoutHistory([historyCommit('tip', ['boundary']), historyCommit('boundary')])
  expect(rows[1]?.edges).toEqual([expect.objectContaining({ half: 'top', from: 0, to: 0 })])
})

test('filtered results preserve commit parents without drawing connections across omitted commits', () => {
  const commits = [historyCommit('tip', ['omitted']), historyCommit('root')]
  const rows = layoutHistoryMatches(commits)
  expect(rows.map((row) => row.commit)).toEqual(commits)
  expect(rows.every((row) => row.width === 1 && row.column === 0 && row.edges.length === 0)).toBe(
    true,
  )
})
