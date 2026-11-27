import '@workspace/ui/globals.css'
import { InlineRenameInput as WorkbenchInlineRenameInput } from '@shaulavo/workbench-ui'
import { afterEach, expect, test } from 'vitest'

import { InlineRenameInput } from '../inline-rename-input'
import { mount } from '../../../test/render'

let cleanup = () => {}
afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.shell
})

test('preserves session rail rename height and accent fill across densities', () => {
  const railClassName =
    'bg-accent text-foreground h-auto border-transparent px-(--density-row-padding-x) py-(--density-row-padding-y) text-xs leading-5'

  const mounted = mount(
    <div>
      <InlineRenameInput
        aria-label='Session title'
        className={railClassName}
        initialValue='Fix bug'
        onCancel={() => {}}
        onCommit={() => {}}
      />
      <div className='bg-accent' data-accent-ref='' />
    </div>,
  )
  cleanup = mounted.unmount

  const input = mounted.container.querySelector('input')!
  const accentRef = mounted.container.querySelector<HTMLElement>('[data-accent-ref]')!

  expect(Math.round(input.getBoundingClientRect().height)).toBe(34)
  expect(getComputedStyle(input).backgroundColor).toBe(getComputedStyle(accentRef).backgroundColor)

  document.documentElement.dataset.density = 'compact'
  expect(Math.round(input.getBoundingClientRect().height)).toBe(30)
})

test('preserves session header rename height, transparent fill, and phone padding while keeping tree rename styles intact', () => {
  const headerClassName =
    'text-foreground h-(--density-control-height-sm) min-w-0 flex-1 px-(--density-row-padding-x) text-xs font-medium'

  const mounted = mount(
    <div>
      <InlineRenameInput
        aria-label='Header session title'
        className={headerClassName}
        initialValue='Fix bug'
        onCancel={() => {}}
        onCommit={() => {}}
      />
      <WorkbenchInlineRenameInput
        aria-label='Tree rename'
        autoFocus={false}
        initialValue='file.ts'
        onCancel={() => {}}
        onCommit={() => {}}
      />
    </div>,
  )
  cleanup = mounted.unmount

  const headerInput = mounted.container.querySelector<HTMLInputElement>(
    'input[aria-label="Header session title"]',
  )!
  const treeInput = mounted.container.querySelector<HTMLInputElement>(
    'input[aria-label="Tree rename"]',
  )!

  expect(Math.round(headerInput.getBoundingClientRect().height)).toBe(28)
  expect(getComputedStyle(headerInput).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(getComputedStyle(headerInput).paddingLeft).toBe('8px')

  // Tree's shared Workbench InlineRenameInput keeps its own styled rules.
  expect(getComputedStyle(treeInput).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(getComputedStyle(treeInput).borderStyle).toBe('solid')

  document.documentElement.dataset.shell = 'phone'
  expect(getComputedStyle(headerInput).paddingLeft).toBe('12px')
})
