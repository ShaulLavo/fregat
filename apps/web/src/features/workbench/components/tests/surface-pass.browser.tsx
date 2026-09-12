import '@workspace/ui/globals.css'
import { Alert } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { afterEach, expect, test } from 'vitest'

import { PanelLoading } from '@/features/git/components/panel-loading'
import { TreeLoading } from '@/features/workspace/components/tree-loading'

// A harness, not the running app: it stacks the real surface classes the shell
// uses (titlebar bg-card, sidebar bg-background, editor bg-content-well) inside
// [data-workbench], so the tonal separation between panes is exactly what the
// app renders. Used to look at the design language rather than to assert on it.
let root: Root | null = null

afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  delete document.documentElement.dataset.density
  document.documentElement.classList.remove('dark')
})

for (const theme of ['light', 'dark'] as const) {
  test(`surface pass — ${theme}`, async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.dataset.density = 'compact'
    mount(<Shell />)
    await settle()

    await page.screenshot({ path: `surface-${theme}.png` })

    // The value of this file is the image, but a test that asserts nothing is a
    // test that cannot fail when the harness breaks. Assert the two things the
    // screenshot is useless without: the shell rendered, and both loading panes
    // resolved rather than being captured blank.
    expect(document.querySelector('[data-workbench]')).not.toBeNull()
    expect(document.querySelectorAll('.skeleton-sweep').length).toBeGreaterThan(8)
  })
}

function Shell() {
  return (
    <div className='bg-background text-foreground flex h-svh flex-col overflow-hidden'>
      <PaneBar as='header' border='bottom' className='bg-card backdrop-material'>
        <span className='text-xs font-medium'>platform</span>
        <span className='text-muted-foreground text-2xs'>editor.tsx</span>
        <div className='ml-auto flex items-center gap-(--density-gap-tight)'>
          <Button size='icon-sm' variant='ghost' aria-label='Workbench' />
          <Button size='icon-sm' variant='ghost' aria-label='Chat' className='bg-accent' />
        </div>
      </PaneBar>

      <div className='relative flex min-h-0 flex-1' data-workbench=''>
        <aside className='bg-background backdrop-material flex h-full w-72 min-w-0 shrink-0 overflow-hidden'>
          <nav className='flex w-(--rail-width) shrink-0 flex-col items-center gap-1 border-r p-1'>
            <Button size='icon-sm' variant='ghost' className='bg-accent' aria-label='Files' />
            <Button size='icon-sm' variant='ghost' aria-label='Git' />
            <Button size='icon-sm' variant='ghost' aria-label='Search' />
          </nav>
          <div className='min-w-0 flex-1'>
            <TreeLoading />
          </div>
        </aside>

        <section className='bg-content-well flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
          <PaneBar border='bottom'>
            <span className='text-xs font-medium'>editor.tsx</span>
            <Badge className='ml-auto'>3</Badge>
          </PaneBar>
          <div className='flex min-h-0 flex-1 flex-col gap-(--density-section-padding) p-(--density-section-padding)'>
            <InputGroup>
              <InputGroupAddon align='inline-start'>
                <MagnifyingGlassIcon className='size-3.5' />
              </InputGroupAddon>
              <InputGroupInput aria-label='Search' placeholder='Search workspace' />
            </InputGroup>
            <Input aria-label='Plain' placeholder='A plain input' />
            <div className='flex items-center gap-(--density-control-gap)'>
              <Button>Primary</Button>
              <Button variant='outline'>Outline</Button>
              <Button variant='ghost'>Ghost</Button>
              <Button variant='destructive'>Destructive</Button>
            </div>
            <Alert>A boxed callout, on the callout radius step.</Alert>
            <div className='border-border overflow-hidden border'>
              <PaneBar border='bottom'>
                <span className='text-xs font-medium'>Rows</span>
              </PaneBar>
              <div className='hover:bg-row-hover flex h-(--density-row-height) items-center px-(--density-row-padding-x) text-xs'>
                a list row at rest
              </div>
              <div className='bg-row-selected flex h-(--density-row-height) items-center px-(--density-row-padding-x) text-xs'>
                a selected row
              </div>
            </div>
          </div>
        </section>

        <aside className='bg-background backdrop-material h-full w-64 shrink-0 overflow-hidden border-l'>
          <PanelLoading />
        </aside>
      </div>
    </div>
  )
}

function mount(children: ReactNode) {
  const host = document.createElement('main')
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => root?.render(children))
}

// LoadingState holds its skeleton back for 120ms, so the panes are still empty
// on the first frame and a screenshot taken then shows neither. Gate on the
// skeleton itself, and on BOTH panes, rather than on the pane bars, which exist
// immediately and would let the shot race the holdback.
async function settle() {
  await expect
    .poll(() => document.querySelectorAll('.skeleton-sweep').length, { timeout: 3_000 })
    .toBeGreaterThan(8)
  settleAnimations()
}

// An infinite animation cannot be finished — skeleton-sweep is one, and calling
// finish() on it throws. Pause those at frame 0 so a screenshot is deterministic,
// and finish the ones that do end.
function settleAnimations() {
  for (const animation of document.getAnimations()) {
    const endTime = animation.effect?.getComputedTiming().endTime
    if (endTime === Number.POSITIVE_INFINITY) {
      animation.pause()
      animation.currentTime = 0
      continue
    }
    animation.finish()
  }
}
