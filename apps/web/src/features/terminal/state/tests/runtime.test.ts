import { GhosttyRuntime } from 'ghostty-webgpu'
import { vi } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { initializeGhostty } from '@/features/terminal/state/runtime'
import { terminalQueryKeys } from '@/features/terminal/utils/query-keys'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

test('runtime requests join, retain failure, and retry into one real WASM instance', async () => {
  resourceQueryClient.removeQueries({ queryKey: terminalQueryKeys.runtime })
  const create = vi
    .spyOn(GhosttyRuntime, 'create')
    .mockRejectedValueOnce(new Error('fixture initialization failure'))
  try {
    const failed = await Promise.allSettled([initializeGhostty(), initializeGhostty()])
    expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(create).toHaveBeenCalledTimes(1)
    expect(resourceQueryClient.getQueryState(terminalQueryKeys.runtime)?.status).toBe('error')
    const [first, second] = await Promise.all([initializeGhostty(), initializeGhostty()])
    expect(first).toBe(second)
    expect(first).toBeInstanceOf(GhosttyRuntime)
    expect(await initializeGhostty()).toBe(first)
    expect(create).toHaveBeenCalledTimes(2)
  } finally {
    create.mockRestore()
    resourceQueryClient.getQueryData<GhosttyRuntime>(terminalQueryKeys.runtime)?.dispose()
    resourceQueryClient.removeQueries({ queryKey: terminalQueryKeys.runtime })
  }
})
