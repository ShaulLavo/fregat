/** @jsxImportSource react */
// Plan 178 parity: touch drags of today's tree with real CDP touch input. Once a page has seen touch
// input, Chromium reports it as a touch device for the rest of the run (`(hover: hover)` stops
// matching), so this file runs as its own project, after every other tree browser test.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'

import {
  center,
  frames,
  expandPaths,
  scroller,
  stickyRow,
  mountParityTree,
  row,
  unmountParityTree,
} from '@/features/workspace/tests/tree-parity-harness'

afterEach(unmountParityTree)

describe('touch', () => {
  it('pans from a pinned folder', async () => {
    const { model } = await mountParityTree()
    await expandPaths(model, ['src/', 'src/lib/'])
    scroller().scrollTop = 288
    await frames(3)
    const before = scroller().scrollTop
    const start = center(stickyRow('src/lib/'))
    await commands.treeTouch('touchStart', start)
    await commands.treeTouch('touchMove', { x: start.x, y: start.y + 60 })
    await commands.treeTouch('touchEnd', { x: start.x, y: start.y + 60 })
    await vi.waitFor(() => expect(scroller().scrollTop).toBeLessThan(before))
  })

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
