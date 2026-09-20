import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
})

function Crash({ when }: { when: boolean }): null {
  if (when) throw new TypeError('row exploded')
  return null
}

it('contains a crash to the pane body and keeps the header and siblings', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const mounted = mount(
    <div>
      <ToolPane title='Git'>
        <Crash when />
      </ToolPane>
      <p data-sibling=''>still here</p>
    </div>,
  )
  cleanups.push(mounted.unmount)
  expect(mounted.container.querySelector('header')?.textContent).toBe('Git')
  expect(mounted.container.querySelector('[data-sibling]')?.textContent).toBe('still here')
  const body = mounted.container.querySelector('[data-slot="tool-pane-body"]')
  expect(body?.textContent).toContain('Git hit a render error')
  expect(body?.textContent).toContain('row exploded')
})

it('recovers on retry and when a reset key changes', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let broken = true
  function Flaky(): string {
    if (broken) throw new TypeError('flaky')
    return 'healed'
  }
  const mounted = mount(
    <RenderErrorBoundary label='This tab' resetKeys={['a']}>
      <Flaky />
    </RenderErrorBoundary>,
  )
  cleanups.push(mounted.unmount)
  expect(mounted.container.textContent).toContain('This tab hit a render error')

  broken = false
  act(() => mounted.container.querySelector('button')?.click())
  expect(mounted.container.textContent).toBe('healed')

  broken = true
  mounted.render(
    <RenderErrorBoundary label='This tab' resetKeys={['a']}>
      <Flaky key='again' />
    </RenderErrorBoundary>,
  )
  expect(mounted.container.textContent).toContain('This tab hit a render error')
  broken = false
  mounted.render(
    <RenderErrorBoundary label='This tab' resetKeys={['b']}>
      <Flaky key='again' />
    </RenderErrorBoundary>,
  )
  expect(mounted.container.textContent).toBe('healed')
})
