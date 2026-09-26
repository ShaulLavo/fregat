/** @jsxImportSource react */
// Plan 178 parity: keyboard, pointer selection and accessibility of today's tree, driven by real
// input. The keyboard-and-selection sub-plan replaces this machinery; these pin what it must keep.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import {
  center,
  clickRow,
  expandPaths,
  filterInput,
  focusedRowPath,
  frames,
  mountParityTree,
  mouse,
  row,
  scroller,
  treeScope,
  unmountParityTree,
} from './parity-harness'

afterEach(unmountParityTree)

async function focusRow(path: string) {
  row(path).focus()
  await vi.waitFor(() => expect(focusedRowPath()).toBe(path))
}

describe('keyboard', () => {
  it('ArrowUp moves focus up and clamps at the first row', async () => {
    await mountParityTree()
    // Folders sort first, so the chain is the first row.
    await focusRow('docs/')
    await userEvent.keyboard('{ArrowUp}')
    await vi.waitFor(() => expect(focusedRowPath()).toBe('chain/of/one/'))
    await userEvent.keyboard('{ArrowUp}')
    await frames()
    expect(focusedRowPath()).toBe('chain/of/one/')
  })

  it('ArrowRight on a file or an expanded folder moves to the next row', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    await focusRow('docs/')
    await userEvent.keyboard('{ArrowRight}')
    await vi.waitFor(() => expect(focusedRowPath()).toBe('docs/guide.md'))
    await userEvent.keyboard('{ArrowRight}')
    await vi.waitFor(() => expect(focusedRowPath()).toBe('docs/notes.md'))
  })

  it('ArrowLeft moves to the parent, is a no-op at the root, and leaves a chain whole', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/', 'chain/of/one/'])
    await focusRow('docs/notes.md')
    await userEvent.keyboard('{ArrowLeft}')
    await vi.waitFor(() => expect(focusedRowPath()).toBe('docs/'))
    await userEvent.keyboard('{ArrowLeft}')
    await vi.waitFor(() => expect(row('docs/').getAttribute('aria-expanded')).toBe('false'))
    await userEvent.keyboard('{ArrowLeft}')
    await frames()
    expect(focusedRowPath()).toBe('docs/')

    // The chain is one row whose path is its last folder; its child's parent is that row.
    await focusRow('chain/of/one/end.txt')
    await userEvent.keyboard('{ArrowLeft}')
    await vi.waitFor(() => expect(focusedRowPath()).toBe('chain/of/one/'))
    await userEvent.keyboard('{ArrowLeft}')
    await vi.waitFor(() => expect(row('chain/of/one/').getAttribute('aria-expanded')).toBe('false'))
  })

  it('PageDown and PageUp scroll natively without moving focus', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    await focusRow('src/lib/x.ts')
    await userEvent.keyboard('{PageDown}')
    await vi.waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(0))
    expect(model.getFocusedPath()).toBe('src/lib/x.ts')
    const scrolled = scroller().scrollTop
    await userEvent.keyboard('{PageUp}')
    await vi.waitFor(() => expect(scroller().scrollTop).toBeLessThan(scrolled))
    expect(model.getFocusedPath()).toBe('src/lib/x.ts')
  })

  it('Shift+Arrow extends the selection from the focused row and reversing shrinks it', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/'])
    await clickRow('src/a.ts')
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}')
    await vi.waitFor(() =>
      expect([...model.getSelectedPaths()].toSorted()).toEqual([
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
      ]),
    )
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
    await vi.waitFor(() =>
      expect([...model.getSelectedPaths()].toSorted()).toEqual(['src/a.ts', 'src/b.ts']),
    )
  })

  it('arrows move focus only; selection does not follow', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/'])
    await clickRow('src/a.ts')
    await userEvent.keyboard('{ArrowDown}')
    await vi.waitFor(() => expect(focusedRowPath()).toBe('src/b.ts'))
    expect(model.getSelectedPaths()).toEqual(['src/a.ts'])
  })

  it('Enter and Space act as a click: select only this row and toggle a folder', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/'])
    await clickRow('src/a.ts')
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    await vi.waitFor(() => expect(model.getSelectedPaths()).toHaveLength(2))
    await focusRow('docs/')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(row('docs/').getAttribute('aria-expanded')).toBe('true'))
    expect(model.getSelectedPaths()).toEqual(['docs/'])
    await userEvent.keyboard(' ')
    await vi.waitFor(() => expect(row('docs/').getAttribute('aria-expanded')).toBe('false'))
    expect(model.getSelectedPaths()).toEqual(['docs/'])
  })

  it('the ContextMenu key opens the menu on the focused row', async () => {
    const { events } = await mountParityTree()
    await focusRow('docs/')
    await userEvent.keyboard('{ContextMenu}')
    await vi.waitFor(() => expect(events.menus.at(-1)?.item.path).toBe('docs/'))
  })

  it('a letter opens the filter seeded with it; punctuation does not', async () => {
    const { model } = await mountParityTree()
    await focusRow('docs/')
    await userEvent.keyboard('.')
    await userEvent.keyboard('-')
    await frames()
    expect(model.isSearchOpen()).toBe(false)
    await userEvent.keyboard('g')
    await vi.waitFor(() => expect(model.getSearchValue()).toBe('g'))
  })

  it('with the filter open, printable keys on a row are ignored', async () => {
    const { model } = await mountParityTree()
    await focusRow('docs/')
    await userEvent.keyboard('d')
    await vi.waitFor(() => expect(model.isSearchOpen()).toBe(true))
    await focusRow('docs/')
    await userEvent.keyboard('x')
    await frames()
    expect(model.getSearchValue()).toBe('d')
    expect(focusedRowPath()).toBe('docs/')
  })
})

describe('pointer selection', () => {
  it('Mod+click toggles, Shift+click selects a range, Mod+Shift+click merges a range', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'docs/'])
    await clickRow('docs/guide.md')
    await clickRow('src/a.ts', { modifiers: ['ControlOrMeta'] })
    await vi.waitFor(() =>
      expect([...model.getSelectedPaths()].toSorted()).toEqual(['docs/guide.md', 'src/a.ts']),
    )
    await clickRow('src/a.ts', { modifiers: ['ControlOrMeta'] })
    await vi.waitFor(() => expect(model.getSelectedPaths()).toEqual(['docs/guide.md']))

    await clickRow('src/a.ts')
    await clickRow('src/c.ts', { modifiers: ['Shift'] })
    await vi.waitFor(() =>
      expect([...model.getSelectedPaths()].toSorted()).toEqual([
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
      ]),
    )

    await clickRow('docs/guide.md')
    await clickRow('src/a.ts', { modifiers: ['ControlOrMeta'] })
    await clickRow('src/c.ts', { modifiers: ['ControlOrMeta', 'Shift'] })
    await vi.waitFor(() =>
      expect([...model.getSelectedPaths()].toSorted()).toEqual([
        'docs/guide.md',
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
      ]),
    )
  })

  it('double-clicking a folder toggles it twice, leaving it as it was', async () => {
    await mountParityTree()
    await clickRow('docs/', { clickCount: 2 })
    await frames(3)
    expect(row('docs/').getAttribute('aria-expanded')).toBe('false')
  })

  it('a middle mousedown focuses the row', async () => {
    const { model } = await mountParityTree()
    await mouse('down', center(row('docs/')), { button: 'middle' })
    await mouse('up', null, { button: 'middle' })
    await vi.waitFor(() => expect(model.getFocusedPath()).toBe('docs/'))
  })

  it('a click on a flattened chain targets its last folder', async () => {
    const { model } = await mountParityTree()
    await clickRow('chain/of/one/')
    await vi.waitFor(() => expect(model.getSelectedPaths()).toEqual(['chain/of/one/']))
    expect(row('chain/of/one/').getAttribute('aria-expanded')).toBe('true')
  })

  it('a click keeps the scroll position', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    scroller().scrollTop = 200
    await frames(3)
    const before = scroller().scrollTop
    const target = [...treeScope().querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (element) => element.dataset.itemPath?.startsWith('src/lib/z-'),
    )
    if (!target) throw new Error('no list row on screen')
    await mouse('click', center(target))
    await frames(3)
    expect(scroller().scrollTop).toBe(before)
  })
})

describe('accessibility today', () => {
  it('pins the unlabelled parts the rows sub-plans will fix', async () => {
    await mountParityTree({
      gitStatus: [{ path: 'README.md', status: 'modified' }],
    })
    const tree = treeScope().querySelector('[role="tree"]')
    expect(tree).not.toBeNull()
    expect(tree?.getAttribute('aria-label')).toBeNull()
    expect(tree?.getAttribute('aria-multiselectable')).toBeNull()
    expect(filterInput().getAttribute('aria-label')).toBeNull()
    // The git letter is not part of the row's accessible name.
    expect(row('README.md').getAttribute('aria-label')).toBe('README.md')
  })
})
