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
