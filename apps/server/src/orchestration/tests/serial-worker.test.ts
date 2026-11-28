import { describe, expect, it } from 'vitest'
import { SerialWorker } from '../../utils/serial-worker'

describe('SerialWorker', () => {
  it('runs tasks one at a time in enqueue order', async () => {
    const log: string[] = []
    const worker = new SerialWorker<number>(async (task) => {
      log.push(`start:${task}`)
      await Promise.resolve()
      log.push(`end:${task}`)
    })

    await Promise.all([worker.enqueue(1), worker.enqueue(2), worker.enqueue(3)])

    expect(log).toEqual(['start:1', 'end:1', 'start:2', 'end:2', 'start:3', 'end:3'])
  })

  it('drain settles work enqueued while an earlier task is running', async () => {
    const handled: number[] = []
    let worker: SerialWorker<number>
    worker = new SerialWorker(async (task) => {
      handled.push(task)
      if (task !== 1) return

      void worker.enqueue(2)
    })

    void worker.enqueue(1)
    await worker.drain()

    expect(handled).toEqual([1, 2])
  })

  it('drain settles work enqueued after drain was called', async () => {
    const handled: number[] = []
    const worker = new SerialWorker<number>(async (task) => {
      await Promise.resolve()
      handled.push(task)
    })

    const drained = worker.drain()
    void worker.enqueue(1)
    await drained

    expect(handled).toEqual([1])
  })

  it('keeps running after a handler throws', async () => {
    const handled: number[] = []
    const worker = new SerialWorker<number>(async (task) => {
      if (task === 1) throw new Error('failed')

      handled.push(task)
    })

    await expect(worker.enqueue(1)).rejects.toThrow('failed')
    await worker.enqueue(2)
    await worker.drain()

    expect(handled).toEqual([2])
  })

  it('isIdle is false while a task is in flight and true after drain', async () => {
    const gate = Promise.withResolvers<void>()
    const worker = new SerialWorker<void>(async () => {
      await gate.promise
    })

    void worker.enqueue()
    expect(worker.isIdle()).toBe(false)

    gate.resolve()
    await worker.drain()

    expect(worker.isIdle()).toBe(true)
  })
})
