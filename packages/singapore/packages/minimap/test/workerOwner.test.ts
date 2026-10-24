import { describe, expect, it, vi } from 'vitest'
import { MinimapWorkerOwner } from '../src/workerOwner'
import type { MinimapWorkerResponse } from '../src/types'

describe('MinimapWorkerOwner disposal', () => {
  it('settles disposal and terminates a worker that never acknowledges or errors', async () => {
    const worker = createWorker()
    const owner = new MinimapWorkerOwner({
      onMessage: vi.fn(),
      workerFactory: () => worker as unknown as Worker,
    })
    let settled = false
    const disposal = owner.dispose().then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(true)
    await disposal
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(worker.postMessage).not.toHaveBeenCalled()
    expect(owner.inspect().lifecycle).toBe('disposed')
  })

  it('returns the same promise and rejects new requests after disposal', async () => {
    const worker = createWorker()
    const owner = new MinimapWorkerOwner({
      onMessage: vi.fn(),
      workerFactory: () => worker as unknown as Worker,
    })

    const disposal = owner.dispose()
    expect(owner.dispose()).toBe(disposal)
    await disposal
    expect(owner.dispose()).toBe(disposal)
    expect(owner.post({ type: 'updateSelection', selections: [] })).toBe(false)
    expect(worker.postMessage).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
  })

  it('ignores retained message and error callbacks after teardown', async () => {
    const worker = createWorker()
    const onMessage = vi.fn()
    const onError = vi.fn()
    const owner = new MinimapWorkerOwner({
      onMessage,
      onError,
      workerFactory: () => worker as unknown as Worker,
    })
    const message = worker.onmessage!
    const error = worker.onerror!

    await owner.dispose()
    message({
      data: { type: 'error', message: 'late request failure' },
    } as MessageEvent<MinimapWorkerResponse>)
    error({ message: 'late native failure' } as ErrorEvent)
    expect(onMessage).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(owner.inspect()).toMatchObject({ lifecycle: 'disposed', lastError: null })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('reports a native worker failure and disposes the crashed owner once', async () => {
    const worker = createWorker()
    const onError = vi.fn()
    const owner = new MinimapWorkerOwner({
      onMessage: vi.fn(),
      onError,
      workerFactory: () => worker as unknown as Worker,
    })

    worker.onerror!({ message: 'native failure' } as ErrorEvent)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(owner.inspect()).toMatchObject({
      lifecycle: 'crashed',
      lastError: 'Minimap worker crashed: native failure',
    })
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
    await owner.dispose()
    expect(owner.inspect().lifecycle).toBe('disposed')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('cleans up a failed post and settles subsequent disposal', async () => {
    const worker = createWorker()
    const onError = vi.fn()
    const failure = new DOMException('Worker post failed', 'DataCloneError')
    worker.postMessage.mockImplementation(() => {
      throw failure
    })
    const owner = new MinimapWorkerOwner({
      onMessage: vi.fn(),
      onError,
      workerFactory: () => worker as unknown as Worker,
    })

    expect(owner.post({ type: 'updateSelection', selections: [] })).toBe(false)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
    await owner.dispose()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it.each(['native', 'post'])('preserves the %s error channel when termination fails', (mode) => {
    const worker = createWorker()
    const original = new DOMException('Worker post failed', 'DataCloneError')
    const termination = new DOMException('Worker termination failed')
    const onError = vi.fn()
    worker.terminate.mockImplementation(() => {
      throw termination
    })
    worker.postMessage.mockImplementation(() => {
      throw original
    })
    const owner = new MinimapWorkerOwner({
      onMessage: vi.fn(),
      onError,
      workerFactory: () => worker as unknown as Worker,
    })

    const trigger = () => {
      if (mode === 'native') worker.onerror!({ message: 'native failure' } as ErrorEvent)
      else expect(owner.post({ type: 'updateSelection', selections: [] })).toBe(false)
    }
    expect(trigger).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]![0].message).toBe(
      mode === 'native' ? 'Minimap worker crashed: native failure' : original.message,
    )
    expect(owner.inspect()).toMatchObject({ lifecycle: 'crashed', lastError: termination.message })
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
  })

  it.each(['native', 'post'])(
    'rejects subsequent disposal after failed %s cleanup',
    async (mode) => {
      const worker = createWorker()
      const termination = new DOMException('Worker termination failed')
      worker.terminate.mockImplementation(() => {
        throw termination
      })
      worker.postMessage.mockImplementation(() => {
        throw new DOMException('Worker post failed')
      })
      const owner = new MinimapWorkerOwner({
        onMessage: vi.fn(),
        onError: vi.fn(),
        workerFactory: () => worker as unknown as Worker,
      })
      const message = worker.onmessage!
      const error = worker.onerror!
      try {
        if (mode === 'native') error({ message: 'native failure' } as ErrorEvent)
        else owner.post({ type: 'updateSelection', selections: [] })
      } catch {}

      const disposal = owner.dispose()
      expect(owner.dispose()).toBe(disposal)
      await expect(disposal).rejects.toBe(termination)
      await expect(owner.dispose()).rejects.toBe(termination)
      expect(owner.inspect()).toMatchObject({
        lifecycle: 'crashed',
        lastError: termination.message,
      })
      message({
        data: { type: 'error', message: 'late failure' },
      } as MessageEvent<MinimapWorkerResponse>)
      error({ message: 'late native failure' } as ErrorEvent)
      expect(owner.inspect().lastError).toBe(termination.message)
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(owner.post({ type: 'updateSelection', selections: [] })).toBe(false)
    },
  )

  it('rejects every disposal caller when termination fails and releases listeners', async () => {
    const worker = createWorker()
    const failure = new DOMException('Worker termination failed')
    worker.terminate.mockImplementation(() => {
      throw failure
    })
    const owner = new MinimapWorkerOwner({
      onMessage: vi.fn(),
      workerFactory: () => worker as unknown as Worker,
    })

    const disposal = owner.dispose()
    expect(owner.dispose()).toBe(disposal)
    await expect(disposal).rejects.toBe(failure)
    await expect(owner.dispose()).rejects.toBe(failure)
    expect(owner.inspect()).toMatchObject({ lifecycle: 'crashed', lastError: failure.message })
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
    expect(owner.post({ type: 'updateSelection', selections: [] })).toBe(false)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

function createWorker() {
  return {
    onmessage: null as ((event: MessageEvent<MinimapWorkerResponse>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
}
