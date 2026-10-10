import '@workspace/ui/globals.css'
import { act, useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useTailFollow } from '@workspace/ui/patterns/use-tail-follow'
import type { TailEdge } from '@workspace/ui/patterns/tail-follow'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

async function scrollTo(element: HTMLElement, top: number) {
  await act(async () => {
    element.scrollTop = top
    element.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

it('does not read scrollHeight for disabled VirtualList commits or scroll windows', async () => {
  const items = Array.from({ length: 100 }, (_, index) => index)
  const list = (revision: number) => (
    <VirtualList
      className='h-60'
      items={items}
      getKey={(item) => item}
      renderRow={(item) => <ListRow role='option'>{`Row ${item}, revision ${revision}`}</ListRow>}
    />
  )
  const mounted = mount(list(0))
  cleanups.push(mounted.unmount)
  const scroller = mounted.container.querySelector<HTMLElement>('[data-slot="virtual-list"]')!
  await expect.poll(() => scroller.firstElementChild?.clientHeight).toBe(2400)
  const height = vi.spyOn(scroller, 'scrollHeight', 'get')
  for (let revision = 1; revision <= 5; revision += 1) mounted.render(list(revision))
  await scrollTo(scroller, 960)
  expect(scroller.querySelector('[data-index="40"]')).not.toBeNull()
  expect(height).not.toHaveBeenCalled()
})

function FollowFixture({
  keys,
  enabled = true,
  edge = 'start',
}: {
  readonly keys: readonly number[]
  readonly enabled?: boolean
  readonly edge?: TailEdge
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tail = useTailFollow({
    edge,
    enabled,
    keys,
    scrollRef,
    scrollToEdge: () => {
      const element = scrollRef.current
      if (element) element.scrollTop = edge === 'start' ? 0 : element.scrollHeight
    },
    slack: 24,
  })
  return (
    <>
      <output>{`${tail.following},${tail.arrivals}`}</output>
      <div ref={scrollRef} className='h-60 overflow-auto [overflow-anchor:none]'>
        <div style={{ height: keys.length * 24 }} />
      </div>
    </>
  )
}

it('keeps enabled prepend anchoring and arrival counts', async () => {
  const keys = Array.from({ length: 100 }, (_, index) => index)
  const mounted = mount(<FollowFixture keys={keys} />)
  cleanups.push(mounted.unmount)
  const scroller = mounted.container.querySelector<HTMLElement>('.overflow-auto')!
  await scrollTo(scroller, 480)
  const height = vi.spyOn(scroller, 'scrollHeight', 'get')
  mounted.render(<FollowFixture keys={[-2, -1].concat(keys)} />)
  expect(height).toHaveBeenCalled()
  expect(scroller.scrollTop).toBe(528)
  expect(mounted.container.querySelector('output')?.textContent).toBe('false,2')
})

it('baselines disabled arrivals before enabling and anchors only subsequent prepends', async () => {
  const keys = Array.from({ length: 100 }, (_, index) => index)
  const mounted = mount(<FollowFixture keys={keys} />)
  cleanups.push(mounted.unmount)
  const scroller = mounted.container.querySelector<HTMLElement>('.overflow-auto')!
  await scrollTo(scroller, 480)
  const height = vi.spyOn(scroller, 'scrollHeight', 'get')
  mounted.render(<FollowFixture keys={keys} enabled={false} />)
  const disabledKeys = [-2, -1].concat(keys)
  mounted.render(<FollowFixture keys={disabledKeys} enabled={false} />)
  expect(height).not.toHaveBeenCalled()
  const resumedKeys = [-3].concat(disabledKeys)
  mounted.render(<FollowFixture keys={resumedKeys} />)
  expect(scroller.scrollTop).toBe(480)
  expect(mounted.container.querySelector('output')?.textContent).toBe('false,0')
  mounted.render(<FollowFixture keys={[-4].concat(resumedKeys)} />)
  expect(scroller.scrollTop).toBe(504)
  expect(mounted.container.querySelector('output')?.textContent).toBe('false,1')
})

it('follows enabled end arrivals and leaves an away reader in place', async () => {
  const keys = Array.from({ length: 100 }, (_, index) => index)
  const mounted = mount(<FollowFixture keys={keys} edge='end' />)
  cleanups.push(mounted.unmount)
  const scroller = mounted.container.querySelector<HTMLElement>('.overflow-auto')!
  await scrollTo(scroller, 2160)
  mounted.render(<FollowFixture keys={keys.concat([100])} edge='end' />)
  expect(scroller.scrollTop).toBe(2184)
  await scrollTo(scroller, 480)
  mounted.render(<FollowFixture keys={keys.concat([100, 101])} edge='end' />)
  expect(scroller.scrollTop).toBe(480)
  expect(mounted.container.querySelector('output')?.textContent).toBe('false,1')
})
