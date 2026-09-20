import '@workspace/ui/globals.css'
import { act, useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { mount } from '../../../test/render'

declare module 'vitest/browser' {
  interface BrowserCommands {
    rowPointer(selector: string, pressed: boolean): Promise<void>
    rowKey(selector: string, key: string): Promise<void>
  }
}

const cleanups: Array<() => void> = []
afterEach(async () => {
  await commands.rowPointer('body', false)
  cleanups.splice(0).forEach((cleanup) => cleanup())
  delete document.documentElement.dataset.density
})

function VirtualListbox() {
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    label: `Row ${index}`,
  }))
  const [activeId, onActiveChange] = useState<string | null>('0')
  const {
    activeIndex,
    containerProps: { ref, ...containerProps },
    rowProps,
  } = useListbox({
    role: 'listbox',
    items,
    activeId,
    onActiveChange,
    onCommit: () => {},
  })
  return (
    <VirtualList
      {...containerProps}
      id='virtual-listbox'
      className='h-60'
      scrollRef={ref}
      activeIndex={activeIndex}
      items={items}
      getKey={(item) => item.id}
      renderRow={(item) => (
        <ListRow {...rowProps(item.id)} role='option'>
          {item.label}
        </ListRow>
      )}
    />
  )
}

it('keeps the active descendant mounted after End and manual scrolling', async () => {
  const mounted = mount(<VirtualListbox />)
  cleanups.push(mounted.unmount)
  const list = mounted.container.querySelector<HTMLElement>('#virtual-listbox')!
  await commands.rowKey('#virtual-listbox', 'End')
  expect(document.getElementById(list.getAttribute('aria-activedescendant')!)?.textContent).toBe(
    'Row 99',
  )
  await act(async () => {
    list.scrollTop = 0
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(list.scrollTop).toBe(0)
  expect(document.getElementById(list.getAttribute('aria-activedescendant')!)?.textContent).toBe(
    'Row 99',
  )
  expect(document.activeElement).toBe(list)
})

it('paints hover, pressed, selected, marked and disabled states from the real tokens', async () => {
  const mounted = mount(
    <div className='bg-background w-80'>
      <ListRow id='rest' role='option'>
        Rest
      </ListRow>
      <ListRow id='selected' role='option' selected>
        Selected
      </ListRow>
      <ListRow id='marked' role='option' selected marked>
        Marked
      </ListRow>
      <ListRow id='disabled' role='option' disabled title='Disabled full title'>
        Disabled
      </ListRow>
      <div id='hover-token' className='bg-row-hover' />
      <div id='active-token' className='bg-row-active' />
      <div id='selected-token' className='bg-row-selected' />
    </div>,
  )
  cleanups.push(mounted.unmount)
  const style = (id: string) => getComputedStyle(document.getElementById(id)!)
  await commands.rowPointer('#rest', false)
  expect(style('rest').backgroundColor).toBe(style('hover-token').backgroundColor)
  await commands.rowPointer('#rest', true)
  expect(style('rest').backgroundColor).toBe(style('active-token').backgroundColor)
  expect(style('selected').backgroundColor).toBe(style('selected-token').backgroundColor)
  expect(style('marked').backgroundColor).toBe(style('selected').backgroundColor)
  expect(style('marked').boxShadow).not.toBe(style('selected').boxShadow)
  await commands.rowPointer('#selected', false)
  expect(style('selected').backgroundColor).toBe(style('selected-token').backgroundColor)
  await commands.rowPointer('#disabled', false)
  expect(style('disabled').backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(style('disabled').pointerEvents).not.toBe('none')
  expect(style('disabled').opacity).toBe('0.5')
})

it('remeasures virtual rows when compact density changes the token', async () => {
  const items = Array.from({ length: 100 }, (_, index) => index)
  const mounted = mount(
    <VirtualList
      className='h-60'
      activeIndex={0}
      items={items}
      getKey={(item) => item}
      renderRow={(item) => <ListRow role='option'>{item}</ListRow>}
    />,
  )
  cleanups.push(mounted.unmount)
  const content = mounted.container.querySelector<HTMLElement>('[data-slot="virtual-list"] > div')!
  await expect.poll(() => content.offsetHeight).toBe(2400)
  const list = mounted.container.querySelector<HTMLElement>('[data-slot="virtual-list"]')!
  await act(async () => {
    list.scrollTop = 960
    list.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  await act(async () => {
    document.documentElement.dataset.density = 'compact'
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await expect.poll(() => content.offsetHeight).toBe(2000)
  await expect.poll(() => list.scrollTop).toBe(800)
  expect(mounted.container.querySelectorAll('[data-slot="list-row"]').length).toBeLessThan(40)
})
