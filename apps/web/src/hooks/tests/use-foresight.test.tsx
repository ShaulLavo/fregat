import { act, renderHook } from '@testing-library/react'
import { ForesightManager } from 'js.foresight'
import { test, expect } from '../../../test/fixtures'
import { useForesight } from '../use-foresight'

test('keeps a registration across renders, updates options, and unregisters on detach', () => {
  const element = document.createElement('div')
  document.body.append(element)
  const { result, rerender, unmount } = renderHook(
    ({ enabled }) =>
      useForesight({
        callback: () => {},
        name: 'fixture',
        enabled,
      }),
    { initialProps: { enabled: true } },
  )
  act(() => result.current.elementRef(element))
  const manager = ForesightManager.instance
  expect(manager.registeredElements.has(element)).toBe(true)
  const before = manager.registeredElements.get(element)
  rerender({ enabled: false })
  expect(manager.registeredElements.get(element)?.registerCount).toBe(before?.registerCount)
  expect(manager.registeredElements.get(element)?.isEnabled).toBe(false)
  expect(manager.registeredElements.has(element)).toBe(true)
  unmount()
  expect(manager.registeredElements.has(element)).toBe(false)
  element.remove()
})

test('releases a predicted old callback on option invalidation and ref replacement', async () => {
  const { stubIntersectionObserver } = await import('../../../test/env/intersection-observer')
  stubIntersectionObserver(true)
  const element = document.createElement('button')
  element.getBoundingClientRect = () => new DOMRect(100, 100, 100, 40)
  document.body.append(element)
  const events: string[] = []
  const { result, rerender, unmount } = renderHook(
    ({ name, enabled }) =>
      useForesight({
        callback: () => {
          events.push(`enter:${name}`)
          return () => events.push(`leave:${name}`)
        },
        enabled,
        name,
      }),
    { initialProps: { name: 'first', enabled: true } },
  )
  act(() => result.current.elementRef(element))
  await expect
    .poll(() => ForesightManager.instance.getManagerData.loadedModules.desktopHandler)
    .toBe(true)
  await movePointer(150, 240)
  await movePointer(150, 120)
  await expect.poll(() => events).toEqual(['enter:first'])
  rerender({ name: 'second', enabled: false })
  expect(events).toEqual(['enter:first', 'leave:first'])
  const replacement = document.createElement('button')
  document.body.append(replacement)
  act(() => result.current.elementRef(replacement))
  expect(ForesightManager.instance.registeredElements.has(element)).toBe(false)
  unmount()
  expect(events).toEqual(['enter:first', 'leave:first'])
  element.remove()
  replacement.remove()
})

async function movePointer(clientX: number, clientY: number) {
  await act(async () => {
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX,
        clientY,
        pointerType: 'mouse',
      }),
    )
    await new Promise(requestAnimationFrame)
  })
}
