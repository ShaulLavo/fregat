import { act, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useListbox, type UseListboxOptions } from '@workspace/ui/patterns/use-listbox'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta', disabled: true },
  { id: 'c', label: 'Charlie' },
  { id: 'd', label: 'Delta' },
]

function Listbox(props: Partial<UseListboxOptions<string>>) {
  const [activeId, onActiveChange] = useState<string | null>('a')
  const options = {
    role: 'listbox',
    items,
    activeId,
    onActiveChange,
    onCommit: () => {},
    ...props,
  } satisfies UseListboxOptions<string>
  const { containerProps, rowProps } = useListbox(options)
  return (
    <div {...containerProps} aria-label='Items'>
      {options.items.map((item) => (
        <ListRow
          {...rowProps(item.id)}
          key={item.id}
          role='option'
          disabled={item.disabled}
          title={item.label}
        >
          {item.label}
          <button type='button'>Action {item.id}</button>
        </ListRow>
      ))}
    </div>
  )
}

function renderListbox(props: Partial<UseListboxOptions<string>> = {}) {
  const mounted = mount(<Listbox {...props} />)
  cleanups.push(mounted.unmount)
  const list = mounted.container.querySelector<HTMLElement>('[role="listbox"]')!
  act(() => list.focus())
  return { ...mounted, list }
}

function press(element: HTMLElement, key: string, extras: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extras })
  act(() => element.dispatchEvent(event))
  return event
}

describe('useListbox', () => {
  it('keeps one tab stop and real focus on the container while skipping disabled rows', () => {
    const { list } = renderListbox()
    expect(list.tabIndex).toBe(0)
    expect(
      [...list.querySelectorAll<HTMLElement>('[role="option"]')].every(
        (row) => row.tabIndex === -1,
      ),
    ).toBe(true)
    press(list, 'ArrowDown')
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toContain('Charlie')
    expect(document.activeElement).toBe(list)
    press(list, 'Home')
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toContain('Alpha')
    press(list, 'End')
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toContain('Delta')
  })

  it('preserves nested action focus and lets its keys bubble untouched', () => {
    const { list } = renderListbox()
    const action = list.querySelector('button')!
    action.focus()
    expect(press(action, 'ArrowDown').defaultPrevented).toBe(false)
    act(() => action.click())
    expect(document.activeElement).toBe(action)
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toContain('Alpha')
  })

  it('separates selection from commit and leaves modifier chords alone', () => {
    const onCommit = vi.fn()
    const onSelect = vi.fn()
    const { list } = renderListbox({ onCommit, onSelect })
    press(list, ' ')
    expect(onSelect).toHaveBeenCalledWith('a')
    expect(onCommit).not.toHaveBeenCalled()
    press(list, 'Enter')
    expect(onCommit).toHaveBeenCalledWith('a')
    expect(press(list, 'End', { ctrlKey: true }).defaultPrevented).toBe(false)
  })

  it('only intercepts typeahead when enabled', () => {
    const plain = renderListbox()
    expect(press(plain.list, 'd').defaultPrevented).toBe(false)
    const search = renderListbox({ typeahead: true })
    expect(press(search.list, 'd').defaultPrevented).toBe(true)
    expect(search.list.querySelector('[aria-selected="true"]')?.textContent).toContain('Delta')
  })

  it.each(['aria-pressed', 'data-dragging'])(
    'leaves a picked-up row with %s to the drag sensor',
    (attribute) => {
      const { list } = renderListbox()
      const row = list.querySelector<HTMLElement>('[role="option"]')!
      row.setAttribute(attribute, 'true')
      expect(press(row, 'ArrowDown').defaultPrevented).toBe(false)
    },
  )

  it('does not reveal the cursor again when only the scroll callback changes', () => {
    const reveal = vi.fn()
    const mounted = renderListbox({ scrollToIndex: reveal })
    expect(reveal).toHaveBeenCalledTimes(1)
    const nextReveal = vi.fn()
    mounted.render(<Listbox scrollToIndex={nextReveal} />)
    expect(nextReveal).not.toHaveBeenCalled()
    press(mounted.list, 'End')
    expect(nextReveal).toHaveBeenCalledWith(3)
  })

  it('keeps bindings stable while committed interaction callbacks stay current', () => {
    const record = vi.fn()
    const firstSelect = vi.fn()
    const nextSelect = vi.fn()
    function ObservedList(props: Partial<UseListboxOptions<string>>) {
      const list = useListbox({
        role: 'listbox',
        items,
        activeId: 'a',
        onActiveChange: firstSelect,
        onCommit: () => {},
        ...props,
      })
      record(list)
      return (
        <div {...list.containerProps}>
          <ListRow {...list.rowProps('c')} role='option'>
            Charlie
          </ListRow>
        </div>
      )
    }
    const mounted = mount(<ObservedList />)
    cleanups.push(mounted.unmount)
    const initial = record.mock.calls.at(-1)![0]
    mounted.render(<ObservedList onActiveChange={nextSelect} />)
    const updated = record.mock.calls.at(-1)![0]
    expect(updated.rowBindings).toBe(initial.rowBindings)
    expect(updated.rowProps).toBe(initial.rowProps)
    act(() => mounted.container.querySelector<HTMLElement>('[role="option"]')!.click())
    expect(nextSelect).toHaveBeenCalledWith('c')
    expect(firstSelect).not.toHaveBeenCalled()
    mounted.render(<ObservedList activeId='c' onActiveChange={nextSelect} />)
    const selected = record.mock.calls.at(-1)![0]
    expect(selected.rowBindings).toBe(initial.rowBindings)
    expect(selected.rowProps('c')['aria-selected']).toBe(true)
  })

  it('collapses and expands tree parents and walks into their enabled children', () => {
    const onCollapse = vi.fn()
    const onExpand = vi.fn()
    const mounted = mount(
      <Listbox
        role='tree'
        items={[
          { id: 'a', label: 'Parent', hasChildren: true, expanded: true },
          { id: 'b', label: 'Disabled', parentId: 'a', disabled: true },
          { id: 'c', label: 'Child', parentId: 'a' },
        ]}
        onCollapse={onCollapse}
        onExpand={onExpand}
      />,
    )
    cleanups.push(mounted.unmount)
    const tree = mounted.container.querySelector<HTMLElement>('[role="tree"]')!
    press(tree, 'ArrowRight')
    expect(tree.querySelector('[aria-selected="true"]')?.textContent).toContain('Child')
    press(tree, 'ArrowLeft')
    expect(tree.querySelector('[aria-selected="true"]')?.textContent).toContain('Parent')
    press(tree, 'ArrowLeft')
    expect(onCollapse).toHaveBeenCalledWith('a')
  })
})
