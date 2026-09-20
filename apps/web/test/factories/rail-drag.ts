import { onTestFinished } from 'vitest'
import userEvent from '@testing-library/user-event'

export function installVerticalRailRects() {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rows = [...document.querySelectorAll('[data-slot="list-row"], [data-rail-shelf-target]')]
    const row = rows.includes(this) ? this : this.querySelector('[data-slot="list-row"]')
    const top = Math.max(0, rows.indexOf(row!)) * 30
    return new DOMRect(0, top, 100, 20)
  }
  onTestFinished(() => {
    Element.prototype.getBoundingClientRect = original
  })
}
export async function dragRailWithKeyboard(handle: HTMLElement, move: string) {
  handle.focus()
  await userEvent.keyboard('{ }')
  await userEvent.keyboard(move)
  await userEvent.keyboard('{ }')
}
