import { expect, test } from '../../../test/fixtures'
import { createTuiError } from '@/host/utils/structured-errors'
import { finalize } from '@/utils/finalize'

test('settles cleanup before returning the operation result', async () => {
  const steps: string[] = []
  const result = await finalize(
    async () => {
      steps.push('operation')
      return 42
    },
    () => steps.push('cleanup'),
  )
  steps.push('returned')
  expect(result).toBe(42)
  expect(steps).toEqual(['operation', 'cleanup', 'returned'])
})

test('runs cleanup and preserves the original rejection', async () => {
  const failure = createTuiError('The test operation failed.', 'Retry the operation.')
  let cleaned = false
  await expect(
    finalize(
      () => Promise.reject(failure),
      () => {
        cleaned = true
      },
    ),
  ).rejects.toBe(failure)
  expect(cleaned).toBe(true)
})
