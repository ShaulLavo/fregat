import { describe, expect, it, vi } from 'vitest'

import { AsyncQueue } from '../async-queue'

const DONE = { done: true, value: undefined }

describe('AsyncQueue', () => {
  it('delivers the seed first, then pushes in order whether a reader is parked or not', async () => {
    const queue = new AsyncQueue<number>({ initial: [1, 2] })

    expect(await queue.next()).toEqual({ done: false, value: 1 })
    expect(await queue.next()).toEqual({ done: false, value: 2 })
    const parked = queue.next()
    queue.push(3)
    queue.push(4)
    queue.push(5)

    expect(await parked).toEqual({ done: false, value: 3 })
    expect(await queue.next()).toEqual({ done: false, value: 4 })
    expect(await queue.next()).toEqual({ done: false, value: 5 })
  })

  it('hands pushes to parked readers oldest first', async () => {
    const queue = new AsyncQueue<string>()
    const first = queue.next()
    const second = queue.next()

    queue.push('a')
    queue.push('b')

    expect(await Promise.all([first, second])).toEqual([
      { done: false, value: 'a' },
      { done: false, value: 'b' },
    ])
  })

  it('close settles every parked reader with done and returns what was not delivered', async () => {
    const queue = new AsyncQueue<number>({ initial: [1] })
    expect(await queue.next()).toEqual({ done: false, value: 1 })
    const parked = [queue.next(), queue.next()]

    expect(queue.close()).toEqual([])
    expect(await Promise.all(parked)).toEqual([DONE, DONE])

    queue.push(2)
    expect(await queue.next()).toEqual(DONE)
    expect(queue.closed).toBe(true)
  })

  it('close drops queued items and hands them back once', () => {
    const queue = new AsyncQueue<number>({ initial: [1, 2] })

    expect(queue.close()).toEqual([1, 2])
    expect(queue.close()).toEqual([])
  })

  it('an abort settles every parked reader and removes its listener', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const queue = new AsyncQueue<number>({ signal: controller.signal })
    const parked = [queue.next(), queue.next()]

    controller.abort()

    expect(await Promise.all(parked)).toEqual([DONE, DONE])
    expect(queue.closed).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('an already aborted signal ends the queue before its seed', async () => {
    const queue = new AsyncQueue<number>({ initial: [1], signal: AbortSignal.abort() })

    expect(await queue.next()).toEqual(DONE)
  })

  it('leaving a for-await loop closes the queue and detaches from the signal', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const queue = new AsyncQueue<number>({ initial: [1, 2], signal: controller.signal })

    for await (const item of queue) {
      expect(item).toBe(1)
      break
    }

    expect(queue.closed).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
