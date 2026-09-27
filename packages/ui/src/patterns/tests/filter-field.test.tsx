import { act, createRef, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { FilterField, type FilterFieldHandle } from '@workspace/ui/patterns/filter-field'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function FieldFixture({
  blurBehavior,
  change,
  handle,
}: {
  blurBehavior: 'retain' | 'clear'
  change: (value: string) => void
  handle: React.Ref<FilterFieldHandle>
}) {
  const [value, setValue] = useState('notes')
  const list = createRef<HTMLDivElement>()
  return (
    <>
      <FilterField
        ref={handle}
        aria-label='Filter items'
        clearLabel='Clear filter'
        value={value}
        blurBehavior={blurBehavior}
        onValueChange={(next) => {
          setValue(next)
          change(next)
        }}
        onArrowDown={() => list.current?.focus()}
      />
      <div ref={list} tabIndex={0} role='listbox' />
    </>
  )
}

function field(blurBehavior: 'retain' | 'clear' = 'retain') {
  const change = vi.fn()
  const handle = createRef<FilterFieldHandle>()
  const mounted = mount(
    <FieldFixture blurBehavior={blurBehavior} change={change} handle={handle} />,
  )
  cleanups.push(mounted.unmount)
  const input = mounted.container.querySelector('input')!
  const list = mounted.container.querySelector<HTMLElement>('[role="listbox"]')!
  act(() => input.focus())
  return { input, list, handle, change, ...mounted }
}

function key(input: HTMLInputElement, key: string, options: KeyboardEventInit = {}) {
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options }),
    ),
  )
}

it('clears on Escape and blurs on the next Escape', () => {
  const { input, change } = field()
  key(input, 'Escape')
  expect(input.value).toBe('')
  expect(document.activeElement).toBe(input)
  expect(change).toHaveBeenCalledExactlyOnceWith('')
  key(input, 'Escape')
  expect(document.activeElement).not.toBe(input)
})

it.each(['retain', 'clear'] as const)('moves to the list with the %s blur policy', (policy) => {
  const { input, list } = field(policy)
  key(input, 'ArrowDown')
  expect(document.activeElement).toBe(list)
  expect(input.value).toBe(policy === 'retain' ? 'notes' : '')
})

it('keeps clear-button focus inside the field until it clears and returns to the input', () => {
  const { input, container, change } = field('clear')
  const button = container.querySelector('button')!
  act(() => button.focus())
  expect(input.value).toBe('notes')
  expect(change).not.toHaveBeenCalled()
  act(() => button.click())
  expect(input.value).toBe('')
  expect(document.activeElement).toBe(input)
  expect(change).toHaveBeenCalledExactlyOnceWith('')
})

it('seeds a character and focuses the field without appending the previous query', () => {
  const { input, list, handle, change } = field()
  act(() => list.focus())
  act(() => handle.current?.seed('x'))
  expect(input.value).toBe('x')
  expect(document.activeElement).toBe(input)
  expect(change).toHaveBeenCalledExactlyOnceWith('x')
})

it('leaves composing keys to the IME, including keyCode 229', () => {
  const { input, change } = field()
  for (const value of ['Enter', 'Escape', 'ArrowDown']) {
    key(input, value, { isComposing: true })
    key(input, value, { keyCode: 229 })
  }
  expect(change).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(input)
  expect(input.value).toBe('notes')
})

it('settles an empty clear-on-blur search session', () => {
  const { input, list, change } = field('clear')
  key(input, 'Escape')
  change.mockClear()
  act(() => list.focus())
  expect(change).toHaveBeenCalledExactlyOnceWith('')
})
