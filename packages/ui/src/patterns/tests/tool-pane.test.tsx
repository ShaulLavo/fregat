import { afterEach, expect, it } from 'vitest'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

it('keeps its header while pending takes priority over error and empty', () => {
  const mounted = mount(
    <ToolPane title='Files' state={{ pending: true, error: true, empty: true }}>
      Content
    </ToolPane>,
  )
  cleanups.push(mounted.unmount)
  expect(mounted.container.querySelector('header')?.textContent).toBe('Files')
  expect(mounted.container.querySelector('[data-slot="loading-state"]')).not.toBeNull()
  expect(mounted.container.querySelector('[data-slot="empty-state"]')).toBeNull()
  mounted.render(
    <ToolPane
      title='Files'
      state={{ error: true, empty: true }}
      errorState='Failed'
      emptyState='Empty'
    >
      Content
    </ToolPane>,
  )
  expect(mounted.container.querySelector('[data-slot="tool-pane-body"]')?.textContent).toBe(
    'Failed',
  )
  mounted.render(
    <ToolPane title='Files' state={{ empty: true }} emptyState='Empty'>
      Content
    </ToolPane>,
  )
  expect(mounted.container.querySelector('[data-slot="tool-pane-body"]')?.textContent).toBe('Empty')
})

it('supports a headerless pane with the same body', () => {
  const mounted = mount(<ToolPane header={null}>Terminal</ToolPane>)
  cleanups.push(mounted.unmount)
  expect(mounted.container.querySelector('header')).toBeNull()
  expect(mounted.container.querySelector('[data-slot="tool-pane-body"]')?.textContent).toBe(
    'Terminal',
  )
})
