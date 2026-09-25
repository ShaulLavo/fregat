import { act, Profiler } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HoldButton } from '@workspace/ui/components/hold-button'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function renderHold(onRender?: () => void) {
  const onConfirm = vi.fn()
  const mounted = mount(
    <Profiler id='hold' onRender={() => onRender?.()}>
      <HoldButton onConfirm={onConfirm}>Discard</HoldButton>
    </Profiler>,
  )
  cleanups.push(mounted.unmount)
  const button = mounted.container.querySelector<HTMLButtonElement>('button')!
  const fill = button.querySelector<HTMLElement>('.hold-button-fill')!
  return { onConfirm, button, fill }
}

function fire(target: Element, event: Event) {
  act(() => {
    target.dispatchEvent(event)
  })
}

function pointer(target: Element, type: string) {
  fire(target, new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }))
}

function key(target: Element, type: 'keydown' | 'keyup', value: string, repeat = false) {
  fire(target, new KeyboardEvent(type, { bubbles: true, cancelable: true, key: value, repeat }))
}

/** The fill landing: what the browser fires when the clip-path transition completes. */
function land(fill: Element) {
  const event = new Event('transitionend', { bubbles: true })
  Object.defineProperty(event, 'propertyName', { value: 'clip-path' })
  fire(fill, event)
}

describe('HoldButton', () => {
  it('confirms once when a pointer hold lands', () => {
    const { onConfirm, button, fill } = renderHold()
    pointer(button, 'pointerdown')
    expect(button.hasAttribute('data-holding')).toBe(true)
    land(fill)
    land(fill)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(button.hasAttribute('data-holding')).toBe(false)
  })

  it('cancels a hold when disabled and stays cancelled after re-enabling', () => {
    const onConfirm = vi.fn()
    const mounted = mount(<HoldButton onConfirm={onConfirm}>Discard</HoldButton>)
    cleanups.push(mounted.unmount)
    const button = mounted.container.querySelector('button')!
    const fill = button.querySelector('.hold-button-fill')!
    pointer(button, 'pointerdown')
    mounted.render(
      <HoldButton disabled onConfirm={onConfirm}>
        Discard
      </HoldButton>,
    )
    land(fill)
    expect(onConfirm).not.toHaveBeenCalled()
    mounted.render(<HoldButton onConfirm={onConfirm}>Discard</HoldButton>)
    land(fill)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(button.hasAttribute('data-holding')).toBe(false)
  })

  it('does not confirm when released early', () => {
    const { onConfirm, button, fill } = renderHold()
    pointer(button, 'pointerdown')
    pointer(button, 'pointerup')
    land(fill)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('holds with Space and ignores key repeat', () => {
    const { onConfirm, button, fill } = renderHold()
    key(button, 'keydown', ' ')
    key(button, 'keydown', ' ', true)
    expect(button.hasAttribute('data-holding')).toBe(true)
    land(fill)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels on blur', () => {
    const { onConfirm, button, fill } = renderHold()
    act(() => button.focus())
    key(button, 'keydown', 'Enter')
    act(() => button.blur())
    land(fill)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('renders on press and on landing, never per frame', () => {
    let renders = 0
    const { button, fill } = renderHold(() => {
      renders += 1
    })
    const before = renders
    pointer(button, 'pointerdown')
    land(fill)
    expect(renders - before).toBe(2)
  })

  it('names the hold without changing the button name', () => {
    const { button } = renderHold()
    const hint = document.getElementById(button.getAttribute('aria-describedby')!)
    expect(hint?.textContent).toBe('Hold to confirm')
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('Discard')
  })
})
