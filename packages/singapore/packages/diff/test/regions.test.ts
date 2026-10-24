import { expect, it } from 'vitest'
import { createTextDiff } from '../src/model'
import { createDiffRegionStore } from '../src/regions'

const oldFile = { path: 'identity.js', text: 'a\nb\nc\n' }
const firstOptions = {
  contextLines: 0,
  oldFile,
  newFile: { path: oldFile.path, text: 'a\nchanged\nc\n' },
}

it.each([
  {
    side: 'new',
    oldFile,
    newFile: { path: oldFile.path, text: 'a\nb\nchanged\n' },
  },
  {
    side: 'old',
    oldFile: { path: oldFile.path, text: 'a\ndifferent\nc\n' },
    newFile: firstOptions.newFile,
  },
])('clears expansion for equal-sized distinct $side content', ({ oldFile, newFile }) => {
  const first = createTextDiff(firstOptions)
  const next = createTextDiff({ contextLines: 0, oldFile, newFile })
  expect([next.oldLines.length, next.newLines.length, next.hunks.length]).toEqual([
    first.oldLines.length,
    first.newLines.length,
    first.hunks.length,
  ])
  const regions = createDiffRegionStore()
  regions.setFile(first)
  regions.toggleRegion('0:0')
  regions.setFile(next)
  expect(regions.getExpandedRegions().size).toBe(0)
})

it('keeps expansion when the same content is reconstructed', () => {
  const regions = createDiffRegionStore()
  regions.setFile(createTextDiff(firstOptions))
  regions.toggleRegion('0:0')
  regions.setFile(createTextDiff(firstOptions))
  expect(regions.isExpanded('0:0')).toBe(true)
})

it('clears expansion when unchanged input gets different hunk geometry', () => {
  const first = createTextDiff(firstOptions)
  const next = createTextDiff({ ...firstOptions, contextLines: 1 })
  expect(next.oldLines).toEqual(first.oldLines)
  expect(next.newLines).toEqual(first.newLines)
  expect(next.hunks).toHaveLength(first.hunks.length)
  expect(next.hunks[0]?.oldStart).not.toBe(first.hunks[0]?.oldStart)
  const regions = createDiffRegionStore()
  regions.setFile(first)
  regions.toggleRegion('0:0')
  regions.setFile(next)
  expect(regions.getExpandedRegions().size).toBe(0)
})

it('uses explicit cache keys as the caller-provided identity', () => {
  const regions = createDiffRegionStore()
  const first = createTextDiff(firstOptions)
  const next = createTextDiff({
    contextLines: 0,
    oldFile,
    newFile: { path: oldFile.path, text: 'a\nb\nchanged\n' },
  })
  regions.setFile({ ...first, cacheKey: 'first' })
  regions.toggleRegion('0:0')
  regions.setFile({ ...next, cacheKey: 'first' })
  expect(regions.isExpanded('0:0')).toBe(true)
  regions.setFile({ ...next, cacheKey: 'next' })
  expect(regions.getExpandedRegions().size).toBe(0)
})
