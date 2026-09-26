import { act } from 'react'
import { afterEach, expect, it } from 'vitest'
import { WidthHandle } from '@workspace/ui/patterns/width-handle'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function handleFor(widths: number[], width = 200) {
  const mounted = mount(
    <div style={{ width }}>
      <WidthHandle
        label='Resize column'
        max={400}
        min={120}
        width={width}
        onFit={() => widths.push(-1)}
        onResize={(next) => widths.push(next)}
      />
    </div>,
  )
  cleanups.push(mounted.unmount)
  const handle = mounted.container.querySelector<HTMLElement>('[role="separator"]')
  if (!handle) throw new TypeError('no separator rendered')
  return handle
}

function key(handle: HTMLElement, init: KeyboardEventInit) {
  act(() => handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })))
}

it('names its value and bounds for assistive tech', () => {
  const handle = handleFor([])
  expect(handle.getAttribute('aria-label')).toBe('Resize column')
  expect(handle.getAttribute('aria-valuenow')).toBe('200')
  expect(handle.getAttribute('aria-valuemin')).toBe('120')
  expect(handle.getAttribute('aria-valuemax')).toBe('400')
  expect(handle.tabIndex).toBe(0)
})

it('steps with the arrows and jumps to the bounds, clamped', () => {
  const widths: number[] = []
  const handle = handleFor(widths, 390)
  key(handle, { key: 'ArrowLeft' })
  key(handle, { key: 'ArrowRight' })
  key(handle, { key: 'ArrowLeft', shiftKey: true })
  key(handle, { key: 'Home' })
  key(handle, { key: 'End' })
  expect(widths).toEqual([374, 400, 326, 120, 400])
})

it('fits on double-click', () => {
  const widths: number[] = []
  const handle = handleFor(widths)
  act(() => handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(widths).toEqual([-1])
})
