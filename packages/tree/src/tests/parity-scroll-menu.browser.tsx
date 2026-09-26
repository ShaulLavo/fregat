/** @jsxImportSource react */
// Plan 178 parity: scrolling, sticky folders and the row menu of today's tree, driven by real
// input. The virtualization and context-menu sub-plans replace this machinery.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands, userEvent } from 'vitest/browser'

import {
  center,
  clickRow,
  expandPaths,
  focusedRowPath,
  frames,
  hasRow,
  mountParityTree,
  mouse,
  row,
  ROW_HEIGHT,
  scroller,
  stickyRow,
  treeScope,
  unmountParityTree,
} from './parity-harness'

afterEach(async () => {
  await commands.treeReducedMotion(false)
  unmountParityTree()
})

function menuOpen() {
  return document.querySelector('[role="menu"][aria-label="Row menu"]') !== null
}

function stickyPaths() {
  return [...treeScope().querySelectorAll<HTMLElement>('[data-file-tree-sticky-row="true"]')].map(
    (element) => element.dataset.fileTreeStickyPath,
  )
}

function overlayVisible() {
  const overlay = treeScope().querySelector('[data-file-tree-sticky-overlay="true"]')
  return overlay !== null && getComputedStyle(overlay).visibility !== 'hidden'
}

async function wheel(deltaY: number) {
  await commands.treeWheel(center(scroller()), deltaY)
}

async function scrollSettled() {
  await vi.waitFor(
    () =>
      expect(
        treeScope()
          .querySelector('[data-file-tree-virtualized-root]')
          ?.hasAttribute('data-is-scrolling'),
      ).toBe(false),
    { timeout: 2000 },
  )
}

describe('sticky folders', () => {
  it('shows every open ancestor, hides the overlay at the top, and reveals it on the first scroll', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    await frames(2)
    expect(overlayVisible()).toBe(false)
    await wheel(10 * ROW_HEIGHT)
    await vi.waitFor(() => expect(stickyPaths()).toEqual(['src/', 'src/lib/']))
    expect(overlayVisible()).toBe(true)
  })

  it('pushes a sticky folder up as its next sibling arrives and clips it', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/', 'src/', 'src/lib/'])
    // docs/ sticks at row 1 and src/ (row 4) pushes it out between scrollTop 2 and 4 rows.
    let pushed = false
    for (let offset = 1.5; offset <= 4 && !pushed; offset += 0.25) {
      scroller().scrollTop = offset * ROW_HEIGHT
      scroller().dispatchEvent(new Event('scroll'))
      await frames(2)
      if (!stickyPaths().includes('docs/')) continue
      pushed = Number.parseFloat(stickyRow('docs/').style.top) < 0
    }
    expect(pushed).toBe(true)
    expect(stickyRow('docs/').style.clipPath).toMatch(/^inset\(/)
  })

  it('a sticky-row click reveals the real row below its sticky parents and focuses it', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    await wheel(12 * ROW_HEIGHT)
    await scrollSettled()
    await vi.waitFor(() => expect(stickyPaths()).toContain('src/lib/'))
    await mouse('click', center(stickyRow('src/lib/')))
    await vi.waitFor(() => expect(focusedRowPath()).toBe('src/lib/'))
    const flow = row('src/lib/').getBoundingClientRect()
    const parent = stickyPaths().includes('src/') ? stickyRow('src/').getBoundingClientRect() : null
    expect(flow.top).toBeGreaterThanOrEqual(
      (parent?.bottom ?? scroller().getBoundingClientRect().top) - 1,
    )
  })

  it('clamps scrollTop after a collapse shortens the list', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    scroller().scrollTop = scroller().scrollHeight
    await frames(3)
    const item = model.getItem('src/lib/')
    if (item && 'collapse' in item) item.collapse()
    await frames(3)
    expect(scroller().scrollTop).toBeLessThanOrEqual(
      Math.max(0, scroller().scrollHeight - scroller().clientHeight),
    )
    expect(hasRow('zeta.ts')).toBe(true)
  })

  it('reveals smoothly, and instantly under reduced motion', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    model.scrollToPath('src/lib/z-39.ts', { behavior: 'smooth', focus: false, offset: 'top' })
    await frames(1)
    const midway = scroller().scrollTop
    await vi.waitFor(() => expect(hasRow('src/lib/z-39.ts')).toBe(true))
    expect(midway).toBeLessThan(40 * ROW_HEIGHT)

    scroller().scrollTop = 0
    await frames(2)
    await commands.treeReducedMotion(true)
    model.scrollToPath('src/lib/z-39.ts', { behavior: 'smooth', focus: false, offset: 'top' })
    await frames(1)
    expect(scroller().scrollTop).toBeGreaterThan(30 * ROW_HEIGHT)
  })
})

describe('row menu', () => {
  it('targets one row even with a multi-selection and leaves the selection alone', async () => {
    const { model, events } = await mountParityTree()
    await expandPaths(model, ['src/'])
    await clickRow('src/a.ts')
    await clickRow('src/b.ts', { modifiers: ['ControlOrMeta'] })
    await clickRow('src/b.ts', { button: 'right' })
    await vi.waitFor(() => expect(menuOpen()).toBe(true))
    expect(events.menus.at(-1)?.item.path).toBe('src/b.ts')
    expect([...model.getSelectedPaths()].toSorted()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('closes on Escape and gives focus back to the row', async () => {
    await mountParityTree()
    await clickRow('docs/', { button: 'right' })
    await vi.waitFor(() => expect(menuOpen()).toBe(true))
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(menuOpen()).toBe(false))
    await vi.waitFor(() => expect(focusedRowPath()).toBe('docs/'))
  })

  it('closes on an outside click', async () => {
    await mountParityTree()
    await clickRow('docs/', { button: 'right' })
    await vi.waitFor(() => expect(menuOpen()).toBe(true))
    await mouse('click', { x: 500, y: 560 })
    await vi.waitFor(() => expect(menuOpen()).toBe(false))
  })

  it('eats wheel input over the tree while open, so the list stays put and the menu open', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    await clickRow('src/lib/x.ts', { button: 'right' })
    await vi.waitFor(() => expect(menuOpen()).toBe(true))
    await wheel(3 * ROW_HEIGHT)
    await frames(3)
    expect(scroller().scrollTop).toBe(0)
    expect(menuOpen()).toBe(true)
  })

  it('stays open when its row is removed (today; the context-menu sub-plan decides)', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    await clickRow('docs/notes.md', { button: 'right' })
    await vi.waitFor(() => expect(menuOpen()).toBe(true))
    model.remove('docs/notes.md')
    await frames(3)
    expect(hasRow('docs/notes.md')).toBe(false)
    expect(menuOpen()).toBe(true)
  })

  it('an overlay eats pointer input on other rows while it is open', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    await clickRow('docs/guide.md')
    await clickRow('docs/notes.md', { button: 'right' })
    await vi.waitFor(() => expect(menuOpen()).toBe(true))
    await mouse('click', center(row('README.md')))
    await frames(3)
    expect(model.getSelectedPaths()).toEqual(['docs/guide.md'])
  })

  it('ignores a right-click during a scroll and for 50ms after it', async () => {
    const { model, events } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    await wheel(2 * ROW_HEIGHT)
    await mouse('click', center(row('src/lib/y.ts')), { button: 'right' })
    await frames(1)
    expect(events.menus).toHaveLength(0)
    await scrollSettled()
    await new Promise((resolve) => setTimeout(resolve, 80))
    await mouse('click', center(row('src/lib/y.ts')), { button: 'right' })
    await vi.waitFor(() => expect(events.menus).toHaveLength(1))
  })
})
