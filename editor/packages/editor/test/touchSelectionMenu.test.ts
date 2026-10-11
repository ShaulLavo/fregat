import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TouchSelectionMenu, type TouchMenuItem } from '../src/editor/touchSelectionMenu'

let editor: HTMLDivElement
let menu: TouchSelectionMenu
let items: TouchMenuItem[]

beforeEach(() => {
  editor = document.createElement('div')
  document.body.append(editor)
  items = []
  menu = new TouchSelectionMenu(editor, () => items)
})
afterEach(() => {
  menu.dispose()
  editor.remove()
})

it('runs an extension in the activation turn and closes after it settles', async () => {
  const run = vi.fn()
  items.push({ id: 'extra', label: 'Inspect', run })
  menu.show(100, 100)
  const button = document.querySelector<HTMLButtonElement>('[data-action="extra"]')!
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
  button.click()
  expect(run).toHaveBeenCalledOnce()
  await Promise.resolve()
  expect(document.querySelector('.editor-touch-menu')).toBeNull()
})

it('keeps a failed action available and explains the failure', async () => {
  items.push({
    id: 'copy',
    label: 'Copy',
    failureMessage: 'Allow clipboard access and try again.',
    run: () => Promise.reject('permission denied'),
  })
  menu.show(100, 100)
  document.querySelector<HTMLButtonElement>('button')!.click()
  await Promise.resolve()
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    'Allow clipboard access and try again.',
  )
  expect(document.querySelector('.editor-touch-menu')?.hasAttribute('aria-busy')).toBe(false)
})

it('blocks repeated actions while one is pending', async () => {
  let settle: (() => void) | undefined
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve
      }),
  )
  items.push({ id: 'copy', label: 'Copy', run })
  menu.show(100, 100)
  const button = document.querySelector<HTMLButtonElement>('button')!
  button.click()
  button.click()
  expect(run).toHaveBeenCalledOnce()
  settle!()
  await Promise.resolve()
  expect(document.querySelector('.editor-touch-menu')).toBeNull()
})

it('hides on an outside press and respects disabled actions', () => {
  const run = vi.fn()
  items.push({ id: 'cut', label: 'Cut', disabled: true, run })
  menu.show(100, 100)
  document.querySelector<HTMLButtonElement>('button')!.click()
  expect(run).not.toHaveBeenCalled()
  editor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  expect(document.querySelector('.editor-touch-menu')).toBeNull()
})
