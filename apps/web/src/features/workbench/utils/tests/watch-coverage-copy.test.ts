import { expect, test } from '../../../../../test/fixtures'
import { limitedWatchDescription } from '@/features/workbench/utils/watch-coverage-copy'

test('names the whole limit when the folder alone passes it', () => {
  expect(
    limitedWatchDescription({
      mode: 'limited',
      directoryCount: 200_001,
      available: 200_000,
      limit: 200_000,
    }),
  ).toContain('more than 200,000 folders, the folder watch limit')
})

test('names what was free when other folders use part of the limit', () => {
  expect(
    limitedWatchDescription({
      mode: 'limited',
      directoryCount: 50_001,
      available: 50_000,
      limit: 200_000,
    }),
  ).toContain('50,000 of the 200,000 folder watches are free')
})
