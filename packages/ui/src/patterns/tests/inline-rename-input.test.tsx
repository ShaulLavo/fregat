import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { InlineRenameInput } from '@workspace/ui/patterns/inline-rename-input'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function editor(props: Partial<Parameters<typeof InlineRenameInput>[0]> = {}) {
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  const mounted = mount(
    <InlineRenameInput
      aria-label='Rename file'
      initialValue='notes.md'
      onCommit={onCommit}
      onCancel={onCancel}
      {...props}
    />,
  )
  cleanups.push(mounted.unmount)
  const input = mounted.container.querySelector('input')!
  return { ...mounted, input, onCommit, onCancel }
}

function key(input: HTMLInputElement, value: string, options: KeyboardEventInit = {}) {
  act(() =>
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ...options })),
  )
}

it.each(['Enter', 'Escape'])('%s settles once even when blur follows', (value) => {
  const { input, onCommit, onCancel } = editor()
  input.value = 'changed.md'
  key(input, value)
  act(() => input.blur())
  key(input, value)
  expect(onCommit.mock.calls).toEqual(value === 'Enter' ? [['changed.md']] : [])
  expect(onCancel).toHaveBeenCalledTimes(value === 'Escape' ? 1 : 0)
})

it('commits the current draft on blur', () => {
  const { input, onCommit } = editor()
  input.value = 'blur.md'
  act(() => input.blur())
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('blur.md')
})

it('ignores composition Enter and Escape, including legacy keyCode 229', () => {
  const { input, onCommit, onCancel } = editor()
  for (const value of ['Enter', 'Escape']) {
    key(input, value, { isComposing: true })
    key(input, value, { keyCode: 229 })
  }
  expect(onCommit).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
  key(input, 'Enter')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('notes.md')
})

it('selects the entire name including extension, or the requested initial range', () => {
  const whole = editor().input
  expect(document.activeElement).toBe(whole)
  expect([whole.selectionStart, whole.selectionEnd]).toEqual([0, 8])
  const range = editor({ initialSelection: [1, 5] }).input
  expect([range.selectionStart, range.selectionEnd]).toEqual([1, 5])
  range.setSelectionRange(3, 3)
  act(() => range.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
  expect([range.selectionStart, range.selectionEnd]).toEqual([3, 3])
})

it('keeps row activation, dragging and navigation outside the field', () => {
  const { input } = editor()
  const rowAction = vi.fn()
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'keydown']) {
    document.body.addEventListener(type, rowAction)
    act(() => input.dispatchEvent(new Event(type, { bubbles: true })))
    document.body.removeEventListener(type, rowAction)
  }
  expect(rowAction).not.toHaveBeenCalled()
})

it('exposes validation, keeps the invalid edit active and allows Escape', () => {
  const { input, onCommit, onCancel } = editor({ validationMessage: 'Choose a file name.' })
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
    'Choose a file name.',
  )
  key(input, 'Enter')
  act(() => input.blur())
  expect(document.activeElement).toBe(input)
  expect(onCommit).not.toHaveBeenCalled()
  key(input, 'Escape')
  act(() => input.blur())
  expect(onCancel).toHaveBeenCalledTimes(1)
})

it('retains the draft when its owner rerenders with an updated initial value', () => {
  const onValueChange = vi.fn()
  const { input, render, onCommit, onCancel } = editor({ onValueChange })
  act(() => {
    input.value = 'draft.md'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  render(
    <InlineRenameInput
      initialValue='owner.md'
      onCommit={onCommit}
      onCancel={onCancel}
      onValueChange={onValueChange}
    />,
  )
  expect(input.value).toBe('draft.md')
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith('draft.md')
  key(input, 'Enter')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('draft.md')
})
