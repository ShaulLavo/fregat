import '@workspace/ui/globals.css'
import { createDiffRegionStore, createTextDiff } from '@singapore-editor/diff'
import { commands } from 'vitest/browser'
import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

import { DiffEditor } from '@/features/editor/components/diff-editor'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'

// Registered in `vitest.config.ts` under `browser.commands`, which is a runtime registry with no
// types of its own — a caller has to say what it accepts.
declare module 'vitest/browser' {
  interface BrowserCommands {
    diffMouseWheel: (input: {
      readonly deltaX?: number
      readonly deltaY?: number
      readonly selector: string
    }) => Promise<void>
  }
}

// A real browser, because this is the one behaviour in the diff that cheaper environments cannot
// reach. Split panes are kept readable by mirroring one pane's scroll onto the other, and the
// offsets travel oddly: the virtualizer redefines `scrollTop` on the scroll element to return its
// own logical value and folds a scroll into it in a `requestAnimationFrame` scheduled by the very
// same event. So assigning `scrollTop` from a test — which is all happy-dom can do — goes through
// the setter and folds synchronously, exercising a path no wheel ever takes. Only a CDP-level
// wheel behaves like a finger, and only with real layout is there anything to scroll.

const LINE_COUNT = 400

let root: Root | null = null

afterEach(() => {
  if (root) flushSync(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

test('a real wheel over one split pane carries the other with it', async () => {
  mountSplitDiff()
  const left = await paneScroller('old')
  const right = await paneScroller('new')
  expect(left.scrollTop).toBe(0)
  expect(right.scrollTop).toBe(0)

  await commands.diffMouseWheel({ deltaY: 400, selector: '.editor-diff-pane-old' })

  await expect.poll(() => left.scrollTop).toBeGreaterThan(0)
  await expect.poll(() => right.scrollTop).toBe(left.scrollTop)
})

test('a real wheel over the other pane carries the first one back', async () => {
  mountSplitDiff()
  const left = await paneScroller('old')
  const right = await paneScroller('new')
  await commands.diffMouseWheel({ deltaY: 400, selector: '.editor-diff-pane-old' })
  await expect.poll(() => right.scrollTop).toBeGreaterThan(0)

  await commands.diffMouseWheel({ deltaY: -200, selector: '.editor-diff-pane-new' })

  await expect.poll(() => right.scrollTop).toBeLessThan(400)
  await expect.poll(() => left.scrollTop).toBe(right.scrollTop)
})

test('the panes are never seen at different offsets while a wheel is turning', async () => {
  // Ending up equal is not the same as staying equal, and the difference is the whole complaint.
  // The virtualizer suppresses a scroll frame whose mounted row window does not change, deferring
  // to one trailing emit once scrolling stops — so a mirror driven only by that signal sat SEVEN
  // frames behind the pane being driven, measured with this same sampling. Sampling per frame is
  // the only way to see it; both panes settle on the same number either way.
  mountSplitDiff()
  const left = await paneScroller('old')
  const right = await paneScroller('new')

  const samples: string[] = []
  let sampling = true
  const sample = () => {
    if (!sampling) return

    samples.push(`${left.scrollTop}/${right.scrollTop}`)
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)

  await commands.diffMouseWheel({ deltaY: 120, selector: '.editor-diff-pane-old' })
  await new Promise((resolve) => setTimeout(resolve, 120))
  await commands.diffMouseWheel({ deltaY: 120, selector: '.editor-diff-pane-old' })
  await new Promise((resolve) => setTimeout(resolve, 400))
  sampling = false

  expect(samples.length).toBeGreaterThan(20)
  expect(samples.filter((pair) => pair.split('/')[0] !== pair.split('/')[1])).toEqual([])
})

function mountSplitDiff() {
  seedBootMirrorTheme('dark')
  // Changed in one long block on purpose. Two scattered edits over 400 lines project to about
  // SIXTEEN rows — everything between them collapses into `Show N unmodified lines` — and with
  // overscan 12 no row is ever recycled and the mounted window never shifts, so the regime this
  // file exists to test is never entered. A contiguous block keeps the rows.
  const line = (index: number) => `line ${index + 1}`
  const changed = (index: number) =>
    index > 40 && index < 260 ? `${line(index)} changed` : line(index)
  const file = createTextDiff({
    newFile: {
      path: 'repo/a.ts',
      text: `${Array.from({ length: LINE_COUNT }, (_, index) => changed(index)).join('\n')}\n`,
    },
    oldFile: {
      path: 'repo/a.ts',
      text: `${Array.from({ length: LINE_COUNT }, (_, index) => line(index)).join('\n')}\n`,
    },
  })
  const host = document.createElement('div')
  host.style.height = '400px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() =>
    root?.render(
      <StrictMode>
        <AppProviders queryClient={createTestQueryClient()}>
          <DiffEditor file={file} mode='split' regions={createDiffRegionStore()} />
        </AppProviders>
      </StrictMode>,
    ),
  )
}

async function paneScroller(side: 'new' | 'old') {
  const selector = `.editor-diff-pane-${side} .editor-virtualized`
  await expect.poll(() => document.querySelector(selector)).not.toBeNull()

  return document.querySelector<HTMLElement>(selector)!
}
