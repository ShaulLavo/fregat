import { describe, expect, it, vi } from 'vitest'
import { MinimapWorkerOwner } from '../src/workerClient'
import type { MinimapWorkerResponse } from '../src/types'

describe('MinimapWorkerOwner disposal', () => {
  it('settles disposal and terminates a worker that never acknowledges or errors', async () => {
    const worker = {
      onmessage: null as ((event: MessageEvent<MinimapWorkerResponse>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    }
    const owner = new MinimapWorkerOwner({
      onMessage: vi.fn(),
      workerFactory: () => worker as unknown as Worker,
    })
    let settled = false
    const disposal = owner.dispose().then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    try {
      await Promise.resolve()
      expect(settled).toBe(true)
      await disposal
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(owner.inspect().lifecycle).toBe('disposed')
    } finally {
      worker.onerror?.({ message: 'test cleanup' } as ErrorEvent)
    }
  })
})
