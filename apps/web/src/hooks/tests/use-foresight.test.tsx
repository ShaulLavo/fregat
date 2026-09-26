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
