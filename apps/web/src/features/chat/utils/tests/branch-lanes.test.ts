import { expect, test } from 'vitest'
import { branchLanes } from '../branch-lanes'

const branches = (...names: string[]) =>
  names.map((name) => ({ name, current: name === 'main', upstream: null, commit: 'a' }))

test('unknown, missing and self parents leave a flat list without a gutter', () => {
  const list = branches('main', 'external', 'orphan')
  const layout = branchLanes(list, [
    { branch: 'external', baseBranch: null },
    { branch: 'orphan', baseBranch: 'gone' },
    { branch: 'main', baseBranch: 'main' },
  ])
  expect(layout.lanes).toBe(0)
  expect(layout.rows.map((row) => row.branch)).toEqual(list)
})

test('known children follow their parent, with continuous edges through grandchildren', () => {
  const layout = branchLanes(branches('main', 'sibling', 'child', 'grandchild', 'other'), [
    { branch: 'child', baseBranch: 'main' },
    { branch: 'grandchild', baseBranch: 'child' },
    { branch: 'sibling', baseBranch: 'main' },
  ])
  expect(layout.lanes).toBe(3)
  expect(layout.rows.map((row) => [row.branch.name, row.lane])).toEqual([
    ['main', 0],
    ['sibling', 1],
    ['child', 1],
    ['grandchild', 2],
    ['other', 0],
  ])
  expect(layout.rows[0]?.below).toEqual([0])
  expect(layout.rows[1]).toMatchObject({ above: [0], below: [0] })
  expect(layout.rows[2]).toMatchObject({ above: [0], below: [1] })
  expect(layout.rows[3]).toMatchObject({ above: [1], below: [] })
})

test('deep trees share the third lane', () => {
  const layout = branchLanes(branches('main', 'one', 'two', 'three', 'four'), [
    { branch: 'one', baseBranch: 'main' },
    { branch: 'two', baseBranch: 'one' },
    { branch: 'three', baseBranch: 'two' },
    { branch: 'four', baseBranch: 'three' },
  ])
  expect(layout.lanes).toBe(3)
  expect(layout.rows.map((row) => row.lane)).toEqual([0, 1, 2, 2, 2])
})

test('conflicting and cyclic records never claim ancestry', () => {
  const layout = branchLanes(branches('main', 'one', 'two', 'conflict'), [
    { branch: 'one', baseBranch: 'two' },
    { branch: 'two', baseBranch: 'one' },
    { branch: 'conflict', baseBranch: 'main' },
    { branch: 'conflict', baseBranch: 'two' },
  ])
  expect(layout.lanes).toBe(0)
  expect(new Set(layout.rows.map((row) => row.branch.name)).size).toBe(4)
})
