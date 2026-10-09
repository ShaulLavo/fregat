import { expect, it, vi } from 'vitest'
import { FrameCoordinator, type FrameSubmission } from '../frame-coordinator.js'

function fixture() {
  const callbacks = new Map<number, () => void>()
  let next = 0
  const requestFrame = vi.fn((callback: () => void) => {
    callbacks.set(++next, callback)
    return next
  })
  const clock = {
    requestFrame,
    cancelFrame: (handle: number) => {
      callbacks.delete(handle)
    },
    setTimer: () => 0,
    clearTimer: () => {},
  }
  const coordinator = new FrameCoordinator(clock)
  const events: string[] = []
  const submit = vi.fn((commands: readonly GPUCommandBuffer[]) => {
    events.push(`submit:${commands.length}`)
  })
  const finish = vi.fn(() => ({}) as GPUCommandBuffer)
  const createCommandEncoder = vi.fn(() => ({ finish }) as unknown as GPUCommandEncoder)
  const device = { queue: { submit }, createCommandEncoder } as unknown as GPUDevice
  const frame = (name: string): FrameSubmission => ({
    owner: {},
    device,
    encoder: coordinator.createEncoder(device),
    commit: () => {
      events.push(`commit:${name}`)
    },
    notify: () => {
      events.push(`notify:${name}`)
    },
    failed: () => {
      events.push(`failed:${name}`)
    },
  })
  return {
    coordinator,
    createCommandEncoder,
    finish,
    device,
    events,
    frame,
    requestFrame,
    submit,
    run() {
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const callback of pending) callback()
    },
  }
}

it('encodes seventeen surfaces in one callback and submits before all acknowledgements and callbacks', () => {
  const f = fixture()
  for (let index = 0; index < 17; index += 1)
    f.coordinator.requestFrame(() => f.coordinator.submit(f.frame(String(index))))
  expect(f.requestFrame).toHaveBeenCalledOnce()
  expect(f.submit).not.toHaveBeenCalled()
  f.run()
  expect(f.submit).toHaveBeenCalledOnce()
  expect(f.submit.mock.calls[0]![0]).toHaveLength(1)
  expect(f.createCommandEncoder).toHaveBeenCalledOnce()
  expect(f.finish).toHaveBeenCalledOnce()
  expect(f.events).toEqual([
    'submit:1',
    ...Array.from({ length: 17 }, (_, index) => `commit:${index}`),
    ...Array.from({ length: 17 }, (_, index) => `notify:${index}`),
  ])
})

it('submits a synchronous interactive frame immediately outside the grouped callback', () => {
  const f = fixture()
  f.coordinator.submit(f.frame('interactive'))
  expect(f.requestFrame).not.toHaveBeenCalled()
  expect(f.events).toEqual(['submit:1', 'commit:interactive', 'notify:interactive'])
})

it('a same-surface rewrite barrier submits its prior commands before buffers can change', () => {
  const f = fixture(),
    first = f.frame('first')
  f.coordinator.requestFrame(() => f.coordinator.submit(first))
  f.coordinator.requestFrame(() => {
    f.coordinator.flushOwner(first.owner)
    f.events.push('rewrite')
    f.coordinator.submit(f.frame('second'))
  })
  f.run()
  expect(f.events).toEqual([
    'submit:1',
    'commit:first',
    'notify:first',
    'rewrite',
    'submit:1',
    'commit:second',
    'notify:second',
  ])
})

it('cancels one terminal without cancelling its peers', () => {
  const f = fixture()
  const first = f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('cancelled')))
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('peer')))
  f.coordinator.cancelFrame(first)
  f.run()
  expect(f.events).toEqual(['submit:1', 'commit:peer', 'notify:peer'])
})

it('a queue failure reports every affected surface and emits no acknowledgements or frame callbacks', () => {
  const f = fixture()
  f.submit.mockImplementationOnce(() => {
    throw new TypeError('queue unavailable')
  })
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('first')))
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('second')))
  f.run()
  expect(f.events).toEqual(['failed:first', 'failed:second'])
})

it('a callback requesting another paint keeps that work in the next ordinary display turn', () => {
  const f = fixture()
  const first = f.frame('first')
  first.notify = () => {
    f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('next')))
  }
  f.coordinator.requestFrame(() => f.coordinator.submit(first))
  f.run()
  expect(f.events).toEqual(['submit:1', 'commit:first'])
  expect(f.requestFrame).toHaveBeenCalledTimes(2)
  f.run()
  expect(f.events).toEqual(['submit:1', 'commit:first', 'submit:1', 'commit:next', 'notify:next'])
})

it('a clean or error notification barrier commits accepted peers before running external code', () => {
  const f = fixture()
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('peer')))
  f.coordinator.requestFrame(() => {
    f.coordinator.flushPending()
    f.events.push('external-notification')
  })
  f.run()
  expect(f.events).toEqual(['submit:1', 'commit:peer', 'notify:peer', 'external-notification'])
})

it('mixed device queue failures report only after accepted peers have committed', () => {
  const f = fixture()
  const failedDevice = {
    createCommandEncoder: f.createCommandEncoder,
    queue: {
      submit() {
        throw new TypeError('other queue failed')
      },
    },
  } as unknown as GPUDevice
  const peer = f.frame('peer')
  const failed = {
    ...f.frame('failed'),
    device: failedDevice,
    encoder: f.coordinator.createEncoder(failedDevice),
    failed: () => {
      f.events.push(`error-after-peer:${f.events.includes('commit:peer')}`)
    },
  }
  f.coordinator.requestFrame(() => f.coordinator.submit(peer))
  f.coordinator.requestFrame(() => f.coordinator.submit(failed))
  f.run()
  expect(f.events).toEqual(['submit:1', 'commit:peer', 'error-after-peer:true', 'notify:peer'])
})

it('uses a fresh encoder after each ordinary display turn', () => {
  const f = fixture()
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('first')))
  f.run()
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('next')))
  f.run()
  expect(f.createCommandEncoder).toHaveBeenCalledTimes(2)
  expect(f.finish).toHaveBeenCalledTimes(2)
})

it('does not acknowledge an abandoned shared encoder and accepts a fresh retry', () => {
  const f = fixture()
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('peer')))
  f.coordinator.requestFrame(() => {
    const encoder = f.coordinator.createEncoder(f.device)
    f.coordinator.abandonEncoder(f.device, encoder, new TypeError('encoding failed'))
    f.coordinator.submit(f.frame('retry'))
  })
  f.run()
  expect(f.createCommandEncoder).toHaveBeenCalledTimes(2)
  expect(f.finish).toHaveBeenCalledOnce()
  expect(f.events).toEqual(['submit:1', 'commit:retry', 'failed:peer', 'notify:retry'])
})

it('reports a failed finish to every affected surface without submitting or acknowledging', () => {
  const f = fixture()
  f.finish.mockImplementationOnce(() => {
    throw new TypeError('finish failed')
  })
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('first')))
  f.coordinator.requestFrame(() => f.coordinator.submit(f.frame('second')))
  f.run()
  expect(f.finish).toHaveBeenCalledOnce()
  expect(f.submit).not.toHaveBeenCalled()
  expect(f.events).toEqual(['failed:first', 'failed:second'])
})
