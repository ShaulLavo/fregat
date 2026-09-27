import { afterEach, expect, it } from 'vitest'
import { TreeRowLead } from '@workspace/ui/patterns/tree-row-lead'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function lead(node: Parameters<typeof mount>[0]) {
  const mounted = mount(node)
  cleanups.push(mounted.unmount)
  return mounted.container.querySelector<HTMLElement>('[data-slot="tree-row-lead"]')!
}

it('indents one step per level and draws one guide per level at its own offset', () => {
  const element = lead(<TreeRowLead depth={2} expanded guides />)
  const guides = [...element.querySelectorAll<HTMLElement>('[data-slot="tree-row-guide"]')]

  expect(element.style.paddingInlineStart).toBe('calc(2 * var(--tree-indent))')
  expect(guides.map((guide) => guide.style.left)).toEqual([
    'calc(var(--tree-guide-offset) + 0 * var(--tree-indent))',
    'calc(var(--tree-guide-offset) + 1 * var(--tree-indent))',
  ])
})

it('lights only the active guide and draws none without guides', () => {
  const element = lead(<TreeRowLead activeGuide={1} depth={3} guides />)
  const guides = [...element.querySelectorAll('[data-slot="tree-row-guide"]')]

  expect(guides.map((guide) => guide.className.includes('--tree-guide-active-opacity'))).toEqual([
    false,
    true,
    false,
  ])
  expect(lead(<TreeRowLead depth={3} />).querySelector('[data-slot="tree-row-guide"]')).toBeNull()
})

it('holds a chevron for a row that expands and the row icon otherwise', () => {
  const closed = lead(<TreeRowLead depth={0} expanded={false} />)
  const leaf = lead(
    <TreeRowLead depth={0}>
      <i data-icon='' />
    </TreeRowLead>,
  )

  expect(closed.querySelector('[data-slot="tree-chevron"]')?.getAttribute('class')).toContain(
    '-rotate-90',
  )
  expect(leaf.querySelector('[data-slot="tree-chevron"]')).toBeNull()
  expect(leaf.querySelector('[data-slot="tree-row-lane"] > [data-icon]')).not.toBeNull()
})
