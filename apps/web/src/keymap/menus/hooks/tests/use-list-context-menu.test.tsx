import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'

import { test, expect } from '../../../../../test/fixtures'
import { useListContextMenu } from '../use-list-context-menu'

function ListMenu({
  items = ['first', 'second'],
  rowFocus = false,
  scrolling = false,
  touchPolicy = 'suppress',
}: {
  readonly items?: readonly string[]
  readonly rowFocus?: boolean
  readonly scrolling?: boolean
  readonly touchPolicy?: 'suppress' | 'context-menu'
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const menu = useListContextMenu<string>({
    containerRef,
    focusTargetOf: rowFocus ? (target) => document.getElementById(target) : undefined,
    touchPolicy,
    isTargetPresent: (target) => items.includes(target),
  })
  return (
    <>
      <div
        {...menu.containerProps}
        ref={containerRef}
        role='listbox'
        tabIndex={0}
        aria-activedescendant='first'
        data-scrolling={scrolling || undefined}
        onKeyDown={(event) => menu.openOnMenuKey(event, 'first')}
      >
        {items.map((item) => (
          <div
            id={item}
            role='option'
            aria-selected={item === 'first'}
            key={item}
            onContextMenu={(event) => menu.openAtEvent(item, event)}
          >
            {item}
          </div>
        ))}
      </div>
      {menu.anchor ? (
        <div role='menu' data-testid='menu'>
          {JSON.stringify({
            target: menu.target,
            rect: menu.anchor.getBoundingClientRect(),
            returnsTo: menu.returnFocusTo()?.id || menu.returnFocusTo()?.getAttribute('role'),
          })}
        </div>
      ) : null}
    </>
  )
}

test('right-click targets the clicked row at the pointer without changing selection', () => {
  render(<ListMenu />)
  fireEvent.contextMenu(screen.getByRole('option', { name: 'second' }), {
    clientX: 42,
    clientY: 73,
  })
  const menu = JSON.parse(screen.getByTestId('menu').textContent ?? '')
  expect(menu.target).toBe('second')
  expect(menu.rect).toMatchObject({ x: 42, y: 73, height: 0, width: 0 })
  expect(screen.getByRole('option', { name: 'first' })).toHaveAttribute('aria-selected', 'true')
})

test('focus returns to the list, or to the target a list names', () => {
  const view = render(<ListMenu />)
  fireEvent.contextMenu(screen.getByRole('option', { name: 'second' }))
  expect(JSON.parse(screen.getByTestId('menu').textContent ?? '').returnsTo).toBe('listbox')
  view.unmount()

  render(<ListMenu rowFocus />)
  fireEvent.contextMenu(screen.getByRole('option', { name: 'second' }))
  expect(JSON.parse(screen.getByTestId('menu').textContent ?? '').returnsTo).toBe('second')
})

test.each([{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }])(
  'menu key $key anchors at the cursor row',
  (key) => {
    render(<ListMenu />)
    const row = screen.getByRole('option', { name: 'first' })
    row.getBoundingClientRect = () => new DOMRect(10, 20, 300, 25)
    fireEvent.keyDown(screen.getByRole('listbox'), key)
    const menu = JSON.parse(screen.getByTestId('menu').textContent ?? '')
    expect(menu.target).toBe('first')
    expect(menu.rect).toMatchObject({ x: 10, y: 20, width: 300, height: 25 })
  },
)

test('scrolling and touch suppress pointer menus, while a later mouse click opens', () => {
  const view = render(<ListMenu scrolling />)
  const row = screen.getByRole('option', { name: 'first' })
  fireEvent.contextMenu(row)
  expect(screen.queryByTestId('menu')).toBeNull()
  view.rerender(<ListMenu />)
  fireEvent.touchStart(row)
  fireEvent.contextMenu(row)
  expect(screen.queryByTestId('menu')).toBeNull()
  fireEvent.pointerDown(row, { pointerType: 'mouse' })
  fireEvent.contextMenu(row)
  expect(screen.getByTestId('menu')).toBeVisible()
})

test('a phone list can retain native long-press menus while suppressing them during scroll', () => {
  const view = render(<ListMenu touchPolicy='context-menu' scrolling />)
  const row = screen.getByRole('option', { name: 'second' })
  fireEvent.touchStart(row)
  fireEvent.contextMenu(row)
  expect(screen.queryByTestId('menu')).toBeNull()
  view.rerender(<ListMenu touchPolicy='context-menu' />)
  fireEvent.contextMenu(row)
  expect(JSON.parse(screen.getByTestId('menu').textContent ?? '').target).toBe('second')
})

test.each(['scroll', 'wheel'])('list %s closes the menu and restores list focus', (type) => {
  render(<ListMenu />)
  fireEvent.contextMenu(screen.getByRole('option', { name: 'second' }))
  fireEvent(screen.getByRole('listbox'), new Event(type, { bubbles: true }))
  expect(screen.queryByTestId('menu')).toBeNull()
  expect(screen.getByRole('listbox')).toHaveFocus()
})

test('removing the target closes the menu and restores list focus', () => {
  const view = render(<ListMenu />)
  fireEvent.contextMenu(screen.getByRole('option', { name: 'second' }))
  view.rerender(<ListMenu items={['first']} />)
  expect(screen.queryByTestId('menu')).toBeNull()
  expect(screen.getByRole('listbox')).toHaveFocus()
})

test('unmounting a virtual row closes its menu even while the item remains', async () => {
  render(<ListMenu />)
  const row = screen.getByRole('option', { name: 'second' })
  fireEvent.contextMenu(row)
  row.remove()
  await waitFor(() => expect(screen.queryByTestId('menu')).toBeNull())
  expect(screen.getByRole('listbox')).toHaveFocus()
})

test('wheel input inside the menu stays open, while the modal backdrop dismisses', () => {
  render(<ListMenu />)
  fireEvent.contextMenu(screen.getByRole('option', { name: 'second' }))
  fireEvent.wheel(screen.getByRole('menu'))
  expect(screen.getByRole('menu')).toBeVisible()
  fireEvent.wheel(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
  expect(screen.getByRole('listbox')).toHaveFocus()
})
