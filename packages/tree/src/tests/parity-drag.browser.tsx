/** @jsxImportSource react */
// Plan 178 parity: drag and drop of today's tree with real pointer and touch input. The
// drag-and-drop sub-plan moves this onto dnd-kit; these pin what it must keep.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands, userEvent } from 'vitest/browser'

import {
  center,
  clickRow,
  expandPaths,
  frames,
  hasRow,
  mountParityTree,
  mouse,
  row,
  ROW_HEIGHT,
  scroller,
  treeScope,
  unmountParityTree,
} from './parity-harness'

afterEach(unmountParityTree)

type Point = { readonly x: number; readonly y: number }

/** Presses on `from`, moves past the drag threshold and on to `to`, and leaves the button down. */
async function dragTo(from: Point, to: Point) {
  await mouse('move', from)
  await mouse('down')
  await mouse('move', { x: from.x + 12, y: from.y + 6 }, { steps: 4 })
  await mouse('move', to, { steps: 8 })
}

function segment(path: string): HTMLElement {
  const element = treeScope().querySelector<HTMLElement>(`[data-item-flattened-subitem="${path}"]`)
  if (!element) throw new Error(`missing chain segment ${path}`)
  return element
}

describe('drag and drop', () => {
  it('drags the whole selection when a selected row is dragged, without nested duplicates', async () => {
    const { model, events } = await mountParityTree()
    await expandPaths(model, ['docs/', 'src/'])
    await clickRow('src/a.ts')
    await clickRow('docs/', { modifiers: ['ControlOrMeta'] })
    await clickRow('docs/guide.md', { modifiers: ['ControlOrMeta'] })
    await dragTo(center(row('src/a.ts')), center(row('chain/of/one/')))
    await mouse('up')
    await vi.waitFor(() => expect(events.drops).toHaveLength(1))
    expect([...events.drops[0]!.draggedPaths].toSorted()).toEqual(['docs/', 'src/a.ts'])
  })

  it('a folder row drops into it and a file row drops into its parent', async () => {
    const { model, events } = await mountParityTree()
    await expandPaths(model, ['docs/', 'src/'])
    await dragTo(center(row('README.md')), center(row('docs/')))
    await mouse('up')
    await vi.waitFor(() => expect(events.drops).toHaveLength(1))
    expect(events.drops[0]!.target.directoryPath).toBe('docs/')

    await dragTo(center(row('zeta.ts')), center(row('src/b.ts')))
    await mouse('up')
    await vi.waitFor(() => expect(events.drops).toHaveLength(2))
    expect(events.drops[1]!.target.directoryPath).toBe('src/')
  })

  it('a chain segment takes the drop for that folder', async () => {
    const { events } = await mountParityTree()
    await dragTo(center(row('README.md')), center(segment('chain/of/')))
    await mouse('up')
    await vi.waitFor(() => expect(events.drops).toHaveLength(1))
    expect(events.drops[0]!.target.directoryPath).toBe('chain/of/')
    expect(events.drops[0]!.target.flattenedSegmentPath).toBe('chain/of/')
  })

  it('marks the source while dragging and paints no drop-target highlight', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['docs/'])
    await dragTo(center(row('README.md')), center(row('src/')))
    await vi.waitFor(() => expect(row('README.md').dataset.itemDragging).toBe('true'))
    expect(getComputedStyle(row('README.md')).opacity).toBe('0.5')
    expect(getComputedStyle(row('src/')).backgroundColor).toBe(
      getComputedStyle(row('zeta.ts')).backgroundColor,
    )
    await mouse('move', center(row('README.md')), { steps: 4 })
    await mouse('up')
  })

  it('opens a collapsed folder after 800ms of hover', async () => {
    const { events } = await mountParityTree()
    await dragTo(center(row('README.md')), center(row('docs/')))
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(row('docs/').getAttribute('aria-expanded')).toBe('false')
    await vi.waitFor(() => expect(row('docs/').getAttribute('aria-expanded')).toBe('true'), {
      timeout: 1500,
    })
    await mouse('move', center(row('README.md')), { steps: 4 })
    await mouse('up')
    expect(events.drops.every((drop) => drop.target.directoryPath !== 'docs/')).toBe(true)
  })

  it('scrolls when the pointer holds in the 40px edge band', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    const edge = scroller().getBoundingClientRect()
    await dragTo(center(row('src/lib/x.ts')), { x: edge.left + 80, y: edge.bottom - 8 })
    await vi.waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(ROW_HEIGHT))
    // The dragged row stays mounted, parked, once the window leaves it behind.
    await vi.waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(20 * ROW_HEIGHT))
    expect(hasRow('src/lib/x.ts')).toBe(true)
    expect(row('src/lib/x.ts').dataset.itemParked).toBe('true')
    await mouse('up')
  })

  it('Escape cancels the drag', async () => {
    const { events } = await mountParityTree()
    await dragTo(center(row('README.md')), center(row('docs/')))
    await vi.waitFor(() => expect(row('README.md').dataset.itemDragging).toBe('true'))
    await userEvent.keyboard('{Escape}')
    await mouse('up')
    await frames(3)
    expect(events.drops).toHaveLength(0)
    expect(row('README.md').dataset.itemDragging).toBeUndefined()
  })

  it('ignores files dragged in from outside the page', async () => {
    const { events } = await mountParityTree()
    // No real input can carry an OS file into the page; this is the event such a drop delivers.
    const transfer = new DataTransfer()
    transfer.items.add(new File(['x'], 'outside.txt', { type: 'text/plain' }))
    const target = row('docs/')
    const over = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    })
    target.dispatchEvent(over)
    target.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    )
    await frames(2)
    expect(over.defaultPrevented).toBe(false)
    expect(events.drops).toHaveLength(0)
  })
})

describe('touch', () => {
  it('a long press of 400ms starts a drag that drops on release', async () => {
    const { events } = await mountParityTree()
    const start = center(row('README.md'))
    await commands.treeTouch('touchStart', start)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await commands.treeTouch('touchMove', center(row('docs/')))
    // A finger rests before lifting; the target settles on the next frames.
    await new Promise((resolve) => setTimeout(resolve, 100))
    await commands.treeTouch('touchEnd', center(row('docs/')))
    await vi.waitFor(() => expect(events.drops).toHaveLength(1))
    expect(events.drops[0]!.target.directoryPath).toBe('docs/')
    expect(events.menus).toHaveLength(0)
  })

  it('moving past 10px before the long press ends cancels it', async () => {
    const { events } = await mountParityTree()
    const start = center(row('README.md'))
    await commands.treeTouch('touchStart', start)
    // Chromium holds back touchmove inside its ~15px slop, so move past it.
    await commands.treeTouch('touchMove', { x: start.x, y: start.y + 30 })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(row('README.md').dataset.itemDragging).toBeUndefined()
    await commands.treeTouch('touchMove', center(row('docs/')))
    await new Promise((resolve) => setTimeout(resolve, 100))
    await commands.treeTouch('touchEnd', center(row('docs/')))
    await frames(3)
    expect(events.drops).toHaveLength(0)
  })

  it('touchcancel cancels an active touch drag', async () => {
    const { events } = await mountParityTree()
    const start = center(row('README.md'))
    await commands.treeTouch('touchStart', start)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await commands.treeTouch('touchMove', center(row('docs/')))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(events.dropChecks.length).toBeGreaterThan(0)
    await commands.treeTouch('touchCancel', center(row('docs/')))
    await frames(3)
    expect(events.drops).toHaveLength(0)
    expect(row('README.md').dataset.itemDragging).toBeUndefined()
  })
})
