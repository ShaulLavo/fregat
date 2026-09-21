import { QueryClient } from '@tanstack/react-query'
import { createTextDiff } from '@singapore-editor/diff'
import { expect, test } from '../../../../test/fixtures'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import {
  captureDiffPaint,
  diffPaintOwner,
  prepareDiffPaintReload,
  savedDiffPaint,
  savedDiffPaintView,
} from '@/features/editor/state/diff-paint'

const file = createTextDiff({
  oldFile: { path: 'repo/a.ts', objectId: 'old', text: 'before' },
  newFile: { path: 'repo/a.ts', objectId: 'new', text: 'after' },
})

test('native diff cache restores exact panes, expansions and split geometry without query data', () => {
  const owner = new QueryClient()
  prepareDiffPaintReload(owner, testScopedStorage, 'repo')
  captureDiffPaint(
    owner,
    diffPaintOwner(owner),
    'comparison',
    file,
    'old',
    ['region'],
    'old paint',
    { 'diff-old': 40, 'diff-new': 60 },
  )
  captureDiffPaint(
    owner,
    diffPaintOwner(owner),
    'comparison',
    file,
    'new',
    ['region'],
    'new paint',
    { 'diff-old': 40, 'diff-new': 60 },
  )
  const next = new QueryClient()
  prepareDiffPaintReload(next, testScopedStorage, 'repo')
  const target = diffPaintOwner(next)
  expect(savedDiffPaint(target, 'comparison', 'old', null, [])).toBe('old paint')
  expect(savedDiffPaint(target, 'comparison', 'new', file, ['region'])).toBe('new paint')
  expect(savedDiffPaintView(target, 'comparison')?.layout).toEqual({
    'diff-old': 40,
    'diff-new': 60,
  })
  expect(savedDiffPaint(target, 'another comparison', 'old', file, ['region'])).toBeNull()
  expect(
    savedDiffPaint(target, 'comparison', 'new', { ...file, newObjectId: 'changed' }, ['region']),
  ).toBeNull()
  expect(savedDiffPaint(target, 'comparison', 'new', file, ['different region'])).toBeNull()
  expect(next.getQueryCache().getAll()).toHaveLength(0)
})

test('root changes reject late native captures', () => {
  const owner = new QueryClient()
  prepareDiffPaintReload(owner, testScopedStorage, 'repo')
  const target = diffPaintOwner(owner)
  prepareDiffPaintReload(owner, testScopedStorage, 'other')
  captureDiffPaint(owner, target, 'comparison', file, 'old', [], 'paint')
  expect(savedDiffPaint(diffPaintOwner(owner), 'comparison', 'old', null, [])).toBeNull()
})
