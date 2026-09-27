import '@workspace/ui/globals.css'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { KeyButton } from '@/features/phone/components/key-button'

let root: Root | null = null

afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

test('a touch release sends once even when the browser also clicks', () => {
  let presses = 0
  const button = mount(() => presses++)
  const down = touch(button, 'pointerdown')
  expect(down.defaultPrevented).toBe(true)
  touch(button, 'pointerup')
  expect(presses).toBe(1)
  touch(button, 'click')
  expect(presses).toBe(1)
})

test('dragging off or cancelling a touch sends no key', () => {
  let presses = 0
  const button = mount(() => presses++)
  touch(button, 'pointerdown')
  touch(button, 'pointerup', button.getBoundingClientRect().right + 20)
  expect(presses).toBe(0)
  touch(button, 'pointerdown')
  touch(button, 'pointercancel')
  expect(presses).toBe(0)
})

test('mouse and keyboard activation still send a key', async () => {
  let presses = 0
  const button = mount(() => presses++)
  await page.getByRole('button', { name: 'Esc', exact: true }).click()
  expect(presses).toBe(1)
  button.focus()
  await userEvent.keyboard('{Enter}')
  expect(presses).toBe(2)
  await userEvent.keyboard(' ')
  expect(presses).toBe(3)
})

function mount(onPress: () => void) {
  const host = document.createElement('main')
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root?.render(<KeyButton label='Esc' onPress={onPress} />))
  const button = host.querySelector('button')
  expect(button).not.toBeNull()
  return button!
}

function touch(button: HTMLButtonElement, type: string, clientX?: number) {
  const box = button.getBoundingClientRect()
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerType: 'touch',
    clientX: clientX ?? box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  })
  button.dispatchEvent(event)
  return event
}
