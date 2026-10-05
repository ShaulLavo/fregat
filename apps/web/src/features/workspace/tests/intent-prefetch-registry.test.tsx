import { ForesightManager } from 'js.foresight'
import { expect, test } from '../../../../test/fixtures'
import { createIntentPrefetchRegistry } from '../utils/intent-prefetch-registry'

test('pointer departure preserves a focused row until blur and unregister releases once', () => {
  const element = document.createElement('button')
  document.body.append(element)
  const registry = createIntentPrefetchRegistry<string>({ reactivateAfter: 5_000 })
  const events: string[] = []
  registry.sync([target(element, 'first')], (intent, reason) => {
    events.push(`enter:${intent}:${reason}`)
    return () => events.push(`leave:${intent}:${reason}`)
  })
  element.dispatchEvent(new Event('pointerenter'))
  element.dispatchEvent(new Event('focus'))
  element.dispatchEvent(new Event('pointerleave'))
  expect(events).toEqual(['enter:first:hover', 'enter:first:focus', 'leave:first:hover'])
  element.dispatchEvent(new Event('blur'))
  registry.clear()
  expect(events.at(-1)).toBe('leave:first:focus')
  expect(events).toHaveLength(4)
  expect(ForesightManager.instance.registeredElements.has(element)).toBe(false)
  element.remove()
})

test('row recycling releases captured old targets and refreshes same-key callbacks', () => {
  const element = document.createElement('button')
  document.body.append(element)
  const registry = createIntentPrefetchRegistry<string>({ reactivateAfter: 5_000 })
  const events: string[] = []
  registry.sync([target(element, 'first')], (intent) => {
    events.push(`old:${intent}`)
    return () => events.push(`release:${intent}`)
  })
  element.dispatchEvent(new Event('focus'))
  registry.sync([target(element, 'second')], (intent) => {
    events.push(`new:${intent}`)
    return () => events.push(`release:${intent}`)
  })
  expect(events).toEqual(['old:first', 'release:first'])
  element.dispatchEvent(new Event('pointerenter'))
  registry.sync([target(element, 'second')], (intent) => {
    events.push(`fresh:${intent}`)
    return () => events.push(`fresh-release:${intent}`)
  })
  element.dispatchEvent(new Event('focus'))
  expect(events).toContain('fresh:second')
  registry.sync([], () => {})
  expect(events.slice(-2)).toEqual(['release:second', 'fresh-release:second'])
  element.dispatchEvent(new Event('blur'))
  expect(events).toHaveLength(6)
  registry.clear()
  element.remove()
})

function target(element: HTMLElement, key: string) {
  return { element, row: { intent: key, key, meta: { key }, name: `fixture:${key}` } }
}
