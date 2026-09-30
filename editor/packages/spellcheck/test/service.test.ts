import { describe, expect, it, vi } from 'vitest'
import { SpellcheckService } from '../src/service'
import type { SpellcheckWorkerResponse } from '../src/protocol'

function worker() {
  return {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } satisfies Worker
}

function pendingCount(service: SpellcheckService): number {
  return Reflect.get(service, 'pending').size
}

function receive(worker: Worker, data: SpellcheckWorkerResponse): void {
  worker.onmessage?.call(worker, new MessageEvent('message', { data }))
}

describe('worker failures', () => {
  it.each(['check', 'suggest'] as const)(
    '%s rejects a throwing factory asynchronously',
    async (method) => {
      const service = new SpellcheckService({
        workerFactory: () => {
          throw new Error('factory failed')
        },
      })
      const result = method === 'check' ? service.check(['befor']) : service.suggest('befor')
      await expect(result).rejects.toThrow('factory failed')
      expect(pendingCount(service)).toBe(0)
      service.dispose()
    },
  )

  it.each([false, true])('cleans up a failed post, with accepted words: %s', async (accepted) => {
    const broken = worker()
    broken.postMessage.mockImplementation(() => {
      throw new Error('post failed')
    })
    const fresh = worker()
    const factory = vi.fn().mockReturnValueOnce(broken).mockReturnValue(fresh)
    const service = new SpellcheckService({ workerFactory: factory })
    if (accepted) service.setAcceptedWords(['fregat'])
    await expect(service.check(['befor'])).rejects.toThrow('post failed')
    expect(pendingCount(service)).toBe(0)
    expect(broken.terminate).toHaveBeenCalledOnce()
    const retry = service.check(['befor'])
    if (accepted)
      expect(fresh.postMessage).toHaveBeenCalledWith({
        type: 'setAcceptedWords',
        words: ['fregat'],
      })
    receive(fresh, { type: 'check', id: 2, misspelled: ['befor'] })
    await expect(retry).resolves.toEqual(['befor'])
    service.dispose()
  })

  it('settles outstanding requests if accepted-word synchronization fails', async () => {
    const current = worker()
    const service = new SpellcheckService({ workerFactory: () => current })
    const first = service.check(['befor'])
    current.postMessage.mockImplementation(() => {
      throw new Error('post failed')
    })
    const changed = vi.fn()
    service.onDidChangeAcceptedWords(changed)
    service.setAcceptedWords(['fregat'])
    await expect(first).rejects.toThrow('post failed')
    expect(changed).toHaveBeenCalledOnce()
    expect(service.isAccepted('fregat')).toBe(true)
    expect(pendingCount(service)).toBe(0)
    service.dispose()
  })

  it('settles a crash and permits a fresh worker on the next request', async () => {
    const broken = worker()
    const fresh = worker()
    const service = new SpellcheckService({
      workerFactory: vi.fn().mockReturnValueOnce(broken).mockReturnValue(fresh),
    })
    const first = service.check(['befor'])
    const second = service.suggest('befor')
    receive(broken, { type: 'error', id: null, message: 'dictionary failed' })
    await expect(first).rejects.toThrow('dictionary failed')
    await expect(second).rejects.toThrow('dictionary failed')
    expect(pendingCount(service)).toBe(0)
    expect(broken.onmessage).toBeNull()
    expect(broken.onerror).toBeNull()
    const retry = service.check(['befor'])
    service.dispose()
    await expect(retry).rejects.toThrow('disposed')
    await expect(service.suggest('befor')).rejects.toThrow('disposed')
    expect(pendingCount(service)).toBe(0)
  })
})

it('cleans up every pending request when a later check post throws', async () => {
  const current = worker()
  const service = new SpellcheckService({ workerFactory: () => current })
  const first = service.check(['befor'])
  current.postMessage.mockImplementation(() => {
    throw new Error('post failed')
  })
  const second = service.suggest('befor')
  await expect(first).rejects.toThrow('post failed')
  await expect(second).rejects.toThrow('post failed')
  expect(pendingCount(service)).toBe(0)
  service.dispose()
})
