/** @jsxImportSource react */
// Plan 178 parity: the filter, inline rename and the row decoration action of today's tree, driven
// by real input. The chrome and rows sub-plans replace these parts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'

import {
  center,
  clickRow,
  expandPaths,
  filterInput,
  focusedRowPath,
  frames,
  hasRow,
  mountParityTree,
  mouse,
  renameInput,
  row,
  treeScope,
  unmountParityTree,
} from './parity-harness'

afterEach(unmountParityTree)

function expandedPaths() {
  return [...treeScope().querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded="true"]')]
    .map((element) => element.dataset.itemPath)
    .toSorted()
}

describe('filter', () => {
  it('Escape restores the expansion saved when it opened and leaves focus in the box', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    const before = expandedPaths()
    await clickRow('docs/guide.md')
    await userEvent.keyboard('x')
    await vi.waitFor(() => expect(model.isSearchOpen()).toBe(true))
    await userEvent.keyboard('.ts')
    await vi.waitFor(() => expect(hasRow('src/lib/x.ts')).toBe(true))
    expect(expandedPaths()).not.toEqual(before)
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(model.isSearchOpen()).toBe(false))
    expect(expandedPaths()).toEqual(before)
    await frames(2)
    // Focus stays in the emptied filter box, which is always on screen.
    expect(treeScope().activeElement ?? document.activeElement).toBe(filterInput())
    expect(filterInput().value).toBe('')
  })

  it('an empty result shows the collapsed tree with the query kept in the box', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    await clickRow('docs/guide.md')
    await userEvent.keyboard('zzzz')
    await vi.waitFor(() => expect(model.getSearchValue()).toBe('zzzz'))
    await frames(2)
    expect(filterInput().value).toBe('zzzz')
    expect(hasRow('docs/')).toBe(true)
    expect(row('docs/').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('rename', () => {
  it('F2 fills and fully selects the name, selecting only the row', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    await clickRow('docs/guide.md')
    await clickRow('docs/notes.md', { modifiers: ['ControlOrMeta'] })
    await userEvent.keyboard('{F2}')
    await vi.waitFor(() => expect(renameInput()).not.toBeNull())
    const input = renameInput()!
    expect(input.value).toBe('notes.md')
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'notes.md'.length])
    expect(model.getSelectedPaths()).toEqual(['docs/notes.md'])
  })

  it('a blur commits, and focus stays on the row at its new path', async () => {
    const { model, events } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    await clickRow('docs/notes.md')
    await userEvent.keyboard('{F2}')
    await vi.waitFor(() => expect(renameInput()).not.toBeNull())
    await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}later.md')
    await mouse('click', { x: 500, y: 560 })
    await vi.waitFor(() => expect(events.renames).toHaveLength(1))
    expect(events.renames[0]).toMatchObject({
      sourcePath: 'docs/notes.md',
      destinationPath: 'docs/later.md',
    })
    expect(hasRow('docs/later.md')).toBe(true)
  })

  it('Enter commits and keeps focus on the renamed row', async () => {
    const { model, events } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    await clickRow('docs/notes.md')
    await userEvent.keyboard('{F2}')
    await vi.waitFor(() => expect(renameInput()).not.toBeNull())
    await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}later.md{Enter}')
    await vi.waitFor(() => expect(events.renames).toHaveLength(1))
    await vi.waitFor(() => expect(focusedRowPath()).toBe('docs/later.md'))
  })
})

describe('decoration action', () => {
  it('runs without selecting the row', async () => {
    const activated: string[] = []
    const { model } = await mountParityTree({
      renderRowDecoration: ({ item }) =>
        item.path === 'docs/'
          ? {
              text: 'error',
              action: { label: 'Fix with AI', onActivate: () => activated.push(item.path) },
            }
          : null,
    })
    await clickRow('README.md')
    const action = row('docs/').querySelector('[data-item-decoration-action]')
    if (!action) throw new Error('missing decoration action')
    await mouse('click', center(action))
    await vi.waitFor(() => expect(activated).toEqual(['docs/']))
    expect(model.getSelectedPaths()).toEqual(['README.md'])
    // Today the action is not reachable by Tab.
    expect(action.getAttribute('tabindex')).toBeNull()
  })
})
