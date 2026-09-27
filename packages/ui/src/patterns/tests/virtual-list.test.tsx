import { afterEach, expect, it } from 'vitest'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const items = Array.from({ length: 100 }, (_, index) => `row ${index}`)

function list(estimate: ((item: string) => number) | undefined) {
  return (
    <VirtualList
      estimateSize={estimate}
      getKey={(item) => item}
      initialRect={{ width: 400, height: 400 }}
      items={items}
      renderRow={(item) => <div>{item}</div>}
    />
  )
}

it('re-reads row estimates when the list starts or stops estimating them', () => {
  const mounted = mount(list(undefined))
  cleanups.push(mounted.unmount)
  const content = () => mounted.container.querySelector<HTMLElement>('[data-slot] > div')

  mounted.render(list(() => 48))
  expect(content()?.style.height).toBe(`${items.length * 48}px`)

  mounted.render(list(undefined))
  expect(content()?.style.height).not.toBe(`${items.length * 48}px`)
})
