import { QueryObserver } from '@tanstack/react-query'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { claimDiffIntent, startDiffIntent } from '@/lib/intent-prefetch/state/query-intent'

for (const setting of ['prefetch.enabled', 'prefetch.diffs'] as const) {
  test(`${setting} suppresses speculative diff reads`, ({ client }) => {
    void client
    writeBootMirror({ ...DEFAULT_SETTING_VALUES, [setting]: false })
    const queryClient = createTestQueryClient()
    let calls = 0
    const release = startDiffIntent(
      queryClient,
      { queryKey: ['git', 'diffs', 'off'], queryFn: () => ++calls },
      'hover',
    )
    expect(calls).toBe(0)
    release()
    writeBootMirror(DEFAULT_SETTING_VALUES)
  })
}

test('four reads per client, shared leases, leave aborts only the last unclaimed read', async ({
  client,
}) => {
  void client
  writeBootMirror(DEFAULT_SETTING_VALUES)
  const queryClient = createTestQueryClient()
  const signals: AbortSignal[] = []
  const options = (id: number) => ({
    queryKey: ['git', 'diffs', id],
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      signals.push(signal)
      return new Promise<number>(() => {})
    },
  })
  const releases = [0, 1, 2, 3, 4].map((id) => startDiffIntent(queryClient, options(id), 'hover'))
  expect(signals).toHaveLength(4)
  const otherEnvironment = createTestQueryClient()
  const releaseOther = startDiffIntent(otherEnvironment, options(9), 'hover')
  expect(signals).toHaveLength(5)
  releaseOther()
  otherEnvironment.clear()
  const shared = startDiffIntent(queryClient, options(0), 'active-row')
  releases[0]!()
  expect(signals[0]!.aborted).toBe(false)
  shared()
  expect(signals[0]!.aborted).toBe(true)
  claimDiffIntent(queryClient, options(1).queryKey)
  releases[1]!()
  expect(signals[1]!.aborted).toBe(false)
  const observer = new QueryObserver(queryClient, options(2))
  const unsubscribe = observer.subscribe(() => {})
  releases[2]!()
  expect(signals[2]!.aborted).toBe(false)
  unsubscribe()
  releases[3]!()
  releases[4]!()
  queryClient.clear()
})

test('leaving never cancels an earlier imperative open', async ({ client }) => {
  void client
  writeBootMirror(DEFAULT_SETTING_VALUES)
  const queryClient = createTestQueryClient()
  let signal: AbortSignal | undefined
  const options = {
    queryKey: ['git', 'diffs', 'pressed'],
    queryFn: (context: { signal: AbortSignal }) => {
      signal = context.signal
      return new Promise<number>(() => {})
    },
  }
  void queryClient.query(options).catch(() => {})
  startDiffIntent(queryClient, options, 'hover')()
  expect(signal?.aborted).toBe(false)
  queryClient.clear()
})
