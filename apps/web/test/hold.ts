import { act, fireEvent } from '@testing-library/react'

/**
 * Holds a HoldButton to completion: the press, then the fill's clip-path transition landing,
 * which happy-dom never runs on its own.
 */
export function holdToConfirm(button: HTMLElement) {
  fireEvent.pointerDown(button, { button: 0 })
  const fill = button.querySelector('.hold-button-fill')
  if (!fill) throw new TypeError('Expected a hold-to-confirm button')
  const landed = new Event('transitionend', { bubbles: true })
  Object.defineProperty(landed, 'propertyName', { value: 'clip-path' })
  act(() => {
    fill.dispatchEvent(landed)
  })
}
