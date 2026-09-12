import '@workspace/ui/globals.css'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'

import { PanelLoading } from '@/features/git/components/panel-loading'
import { TreeLoading } from '@/features/workspace/components/tree-loading'

// --bar-height, resolved. Every horizontal bar in the app answers to this one
// number; a bar that disagrees is a header that visibly jumps.
//
// This file owns the half of the bar contract only a real browser can settle:
// that the token resolves to these pixels and that a skeleton bar lands on the
// same ones. The other half — that every bar in apps/web spells its height
// h-(--bar-height) rather than hard-coding it — is enforced statically by
// scripts/lint/web-design-census.mjs, which fails when a second bar height exists.
const BAR_HEIGHT = { compact: 36, cozy: 40 } as const

let root: Root | null = null

afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  delete document.documentElement.dataset.density
})

test('the bar token resolves to one height per density', () => {
  mount(
    <section data-testid='reference'>
      <PaneBar border='bottom'>reference</PaneBar>
    </section>,
  )

  for (const density of ['compact', 'cozy'] as const) {
    setDensity(density)
    expect(barHeight('reference'), `bar height in ${density}`).toBe(BAR_HEIGHT[density])
  }
})

// The defect Plan 100 names by hand: a loading header that is a different height
// from the loaded one, so the layout flinches the moment data arrives. The Files
// pane was 28px while loading and 36px once loaded.
test('a skeleton bar is the same height as a real bar', async () => {
  mount(
    <>
      <section data-testid='reference'>
        <PaneBar border='bottom'>reference</PaneBar>
      </section>
      <section data-testid='tree-skeleton'>
        <TreeLoading />
      </section>
      <section data-testid='git-skeleton'>
        <PanelLoading />
      </section>
    </>,
  )

  await skeletonsVisible()

  for (const density of ['compact', 'cozy'] as const) {
    setDensity(density)
    expect(barHeight('tree-skeleton'), `Files skeleton in ${density}`).toBe(BAR_HEIGHT[density])
    expect(barHeight('git-skeleton'), `Git skeleton in ${density}`).toBe(BAR_HEIGHT[density])
    expect(barHeight('tree-skeleton')).toBe(barHeight('reference'))
    expect(barHeight('git-skeleton')).toBe(barHeight('reference'))
  }
})

test('a bar keeps its height when its content would wrap', () => {
  mount(
    <section data-testid='reference'>
      <PaneBar border='bottom'>
        <span>
          A very long pane title that would wrap if the bar let it
          <br />
          and a second line underneath it
        </span>
      </PaneBar>
    </section>,
  )

  setDensity('compact')
  expect(barHeight('reference')).toBe(BAR_HEIGHT.compact)
})

function barHeight(testId: string) {
  const bar = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"] [data-slot="pane-bar"]`,
  )
  expect(bar, `Missing pane bar in ${testId}`).not.toBeNull()

  return Math.round(bar!.getBoundingClientRect().height)
}

function mount(children: ReactNode) {
  const host = document.createElement('main')
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root?.render(children))
}

// LoadingState holds its skeleton back for 120ms so a fast query never flashes
// one, so a skeleton's bar does not exist on the first frame.
async function skeletonsVisible() {
  await expect
    .poll(
      () => document.querySelectorAll('[data-testid$="-skeleton"] [data-slot="pane-bar"]').length,
      { timeout: 2_000 },
    )
    .toBe(2)
}

function setDensity(density: 'compact' | 'cozy') {
  document.documentElement.dataset.density = density
}
