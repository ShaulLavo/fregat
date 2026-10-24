import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TouchSelectionMenu, type TouchMenuItem } from '../src/touchSelectionMenu'

let editor: HTMLDivElement
let menu: TouchSelectionMenu
let items: TouchMenuItem[]

beforeEach(() => {
  editor = document.createElement('div')
  document.body.append(editor)
  items = []
  menu = new TouchSelectionMenu(
    editor,
    () => items,
    () => null,
  )
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

it('keeps pending actions with their own menu after dismissal', async () => {
  const settlements: (() => void)[] = []
  const run = vi.fn(() => new Promise<void>((resolve) => settlements.push(resolve)))
  items.push({ id: 'paste', label: 'Paste', run })
  menu.show(100, 100)
  document.querySelector<HTMLButtonElement>('button')!.click()
  menu.hide()
  menu.show(120, 120)
  const next = document.querySelector<HTMLButtonElement>('button')!
  next.click()
  expect(run).toHaveBeenCalledTimes(2)
  settlements[0]!()
  await Promise.resolve()
  expect(document.querySelector('.editor-touch-menu')?.getAttribute('aria-busy')).toBe('true')
  next.click()
  expect(run).toHaveBeenCalledTimes(2)
  settlements[1]!()
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

it.each(['resize', 'scroll'])('repositions when the visual viewport emits %s', (type) => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  const viewport = Object.assign(new EventTarget(), {
    width: 250,
    height: 250,
    offsetLeft: 0,
    offsetTop: 0,
  })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  try {
    menu.show(100, 100)
    expect(document.querySelector('.editor-touch-menu')).not.toBeNull()
    const element = document.querySelector<HTMLElement>('.editor-touch-menu')!
    const top = element.style.top
    if (type === 'resize') viewport.height = 40
    if (type === 'scroll') viewport.offsetTop = 200
    viewport.dispatchEvent(new Event(type))
    expect(document.querySelector('.editor-touch-menu')).toBe(element)
    expect(element.style.top).not.toBe(top)
    expect(element.style.top).toBe(type === 'resize' ? '32px' : '208px')
  } finally {
    if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor)
    else Reflect.deleteProperty(window, 'visualViewport')
  }
})
