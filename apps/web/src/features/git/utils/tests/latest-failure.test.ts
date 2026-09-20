import { latestUnretriedFailure } from '@/features/git/utils/latest-failure'
import { expect, test } from '../../../../../test/fixtures'

const commit = (status: string, id: number) => ({ id, key: 'commit', status })
const stage = (status: string, id: number) => ({ id, key: 'stage', status })

test('a later success of another step does not hide a failed commit', () => {
  expect(latestUnretriedFailure([commit('error', 1), stage('success', 2)])?.id).toBe(1)
})

test('retrying the same step clears its failure, pending or done', () => {
  expect(latestUnretriedFailure([commit('error', 1), commit('pending', 2)])).toBeNull()
  expect(latestUnretriedFailure([commit('error', 1), commit('success', 2)])).toBeNull()
})

test('the newest of two unretried failures wins', () => {
  expect(latestUnretriedFailure([commit('error', 1), stage('error', 2)])?.id).toBe(2)
})

test('nothing failed, nothing to show', () => {
  expect(latestUnretriedFailure([stage('success', 1)])).toBeNull()
})
