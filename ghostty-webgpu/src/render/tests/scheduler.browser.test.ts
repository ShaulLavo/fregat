import { describe, expect, it } from 'vitest'
import { browserRenderClock } from '../config.js'
import { RenderScheduler } from '../scheduler.js'

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

describe('shared browser frame delivery', () => {
  it('delivers a terminal batch before microtasks and later unrelated native callbacks', async () => {
    const order: string[] = []
    const clock = browserRenderClock()
    const first = new RenderScheduler({
      clock,
      onFrame: () => {
        order.push('first')
        queueMicrotask(() => order.push('microtask'))
      },
    })
    const peer = new RenderScheduler({ clock, onFrame: () => order.push('peer') })
    first.schedule()
    window.requestAnimationFrame(() => order.push('native'))
    peer.schedule()
    await nextFrame()
    expect(order).toEqual(['first', 'peer', 'microtask', 'native'])
    first.dispose()
    peer.dispose()
  })

  it('renders work pending before shared delivery in the same native refresh', async () => {
    const clock = browserRenderClock()
    const delivered: string[] = []
    const peer = new RenderScheduler({ clock, onFrame: () => delivered.push('peer') })
    window.requestAnimationFrame(() => peer.schedule())
    const first = new RenderScheduler({ clock, onFrame: () => delivered.push('first') })
    first.schedule()
    await nextFrame()
    expect(delivered).toEqual(['first', 'peer'])
    first.dispose()
    peer.dispose()
  })

  it('resumes a hidden peer on the next refresh after a mid-batch visibility transition', async () => {
    const clock = browserRenderClock()
    const delivered: string[] = []
    const peer = new RenderScheduler({ clock, onFrame: () => delivered.push('peer') })
    const first = new RenderScheduler({
      clock,
      onFrame: () => {
        delivered.push('first')
        peer.setDocumentVisible(false)
        peer.setDocumentVisible(true)
      },
    })
    first.schedule()
    peer.schedule()
    await nextFrame()
    expect(delivered).toEqual(['first'])
    await nextFrame()
    expect(delivered).toEqual(['first', 'peer'])
    first.dispose()
    peer.dispose()
  })
})
