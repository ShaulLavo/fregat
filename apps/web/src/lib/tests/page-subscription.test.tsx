import { test, expect } from '../../../test/fixtures'
import { startPageSubscription } from '@/lib/state/page-subscription'

test('page departure stops resources once and cached restoration creates fresh resources', () => {
  const controllers: AbortController[] = []
  let stopped = 0
  const dispose = startPageSubscription(() => {
    const controller = new AbortController()
    controllers.push(controller)
    return () => {
      stopped += 1
      controller.abort()
    }
  })
  try {
    window.dispatchEvent(new Event('pageshow'))
    expect(controllers).toHaveLength(1)
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pagehide'))
    expect(stopped).toBe(1)
    expect(controllers[0]!.signal.aborted).toBe(true)
    window.dispatchEvent(new Event('pageshow'))
    expect(controllers).toHaveLength(2)
    expect(controllers[1]!.signal.aborted).toBe(false)
    dispose()
    window.dispatchEvent(new Event('pageshow'))
    expect(controllers).toHaveLength(2)
    expect(stopped).toBe(2)
  } finally {
    dispose()
  }
})

test('a cancelled unsaved-work confirmation keeps subscriptions alive', () => {
  let active = 0
  const dispose = startPageSubscription(() => {
    active += 1
    return () => {
      active -= 1
    }
  })
  const guard = (event: Event) => event.preventDefault()
  window.addEventListener('beforeunload', guard, { capture: true })
  try {
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    expect(active).toBe(1)
    window.dispatchEvent(new Event('pagehide'))
    expect(active).toBe(0)
    window.dispatchEvent(new Event('pageshow'))
    window.removeEventListener('beforeunload', guard, { capture: true })
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    expect(active).toBe(0)
  } finally {
    window.removeEventListener('beforeunload', guard, { capture: true })
    dispose()
  }
})
