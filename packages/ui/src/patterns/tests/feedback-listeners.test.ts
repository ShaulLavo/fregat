import { afterEach, expect, test } from 'vitest'
import { installFeedbackListeners } from '../feedback-listeners'

let dispose = () => {}
afterEach(() => {
  dispose()
  document.body.replaceChildren()
})

test('keyboard depth clears on release, focus loss and teardown', () => {
  document.body.innerHTML = '<button class="pressable">Save</button>'
  const button = document.querySelector('button')!
  dispose = installFeedbackListeners(document)
  const down = () => button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
  down()
  expect(button.hasAttribute('data-pressing')).toBe(true)
  button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))
  expect(button.hasAttribute('data-pressing')).toBe(false)
  down()
  button.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  expect(button.hasAttribute('data-pressing')).toBe(false)
  down()
  dispose()
  expect(button.hasAttribute('data-pressing')).toBe(false)
})

test('disabled controls, text fields and modifier chords do not press', () => {
  document.body.innerHTML =
    '<button class="pressable" disabled>Save</button><input class="pressable" />'
  dispose = installFeedbackListeners(document)
  for (const element of document.body.children) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(element.hasAttribute('data-pressing')).toBe(false)
  }
  const button = document.querySelector('button')!
  button.disabled = false
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
  expect(button.hasAttribute('data-pressing')).toBe(false)
})

test('pointer depth survives popup focus transfer and clears on release, cancellation and teardown', () => {
  document.body.innerHTML = '<button data-press-depth aria-haspopup="listbox">Choose</button>'
  const button = document.querySelector('button')!
  dispose = installFeedbackListeners(document)
  const down = () =>
    button.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 7,
      }),
    )
  down()
  button.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  expect(button.hasAttribute('data-pressing')).toBe(true)
  document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8 }))
  expect(button.hasAttribute('data-pressing')).toBe(true)
  document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
  expect(button.hasAttribute('data-pressing')).toBe(false)
  down()
  document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7 }))
  expect(button.hasAttribute('data-pressing')).toBe(false)
  down()
  window.dispatchEvent(new Event('blur'))
  expect(button.hasAttribute('data-pressing')).toBe(false)
  down()
  dispose()
  expect(button.hasAttribute('data-pressing')).toBe(false)
})
