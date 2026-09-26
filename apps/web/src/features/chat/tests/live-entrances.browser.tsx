import '@workspace/ui/globals.css'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { useLiveEntrances } from '../hooks/use-live-entrances'

let root: Root | null = null
afterEach(() => {
  flushSync(() => root?.unmount())
  document.body.replaceChildren()
  delete document.documentElement.dataset.feel
})

function Rows({
  element,
  ids,
  visible = true,
}: {
  element: HTMLElement
  ids: readonly { id: string }[]
  visible?: boolean
}) {
  useLiveEntrances(element, ids)
  return visible
    ? ids.map(({ id }) => (
        <div key={id} data-timeline-row-id={id}>
          {id}
        </div>
      ))
    : null
}

test('only live arrivals enter; initial rows, prepend and virtualized remount stay still', async () => {
  document.documentElement.dataset.feel = 'seam'
  const element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  const initial = [{ id: 'one' }]
  flushSync(() => root!.render(<Rows element={element} ids={initial} />))
  expect(element.querySelectorAll('[data-entering]')).toHaveLength(0)
  const next = [...initial, { id: 'two' }]
  flushSync(() => root!.render(<Rows element={element} ids={next} />))
  const arriving = element.querySelector<HTMLElement>('[data-entering]')!
  expect(arriving.dataset.timelineRowId).toBe('two')
  expect(arriving.getAnimations()).toHaveLength(1)
  arriving.getAnimations().forEach((animation) => animation.finish())
  await expect.poll(() => element.querySelectorAll('[data-entering]').length).toBe(0)
  flushSync(() => root!.render(<Rows element={element} ids={next} visible={false} />))
  flushSync(() => root!.render(<Rows element={element} ids={next} />))
  expect(element.querySelectorAll('[data-entering]')).toHaveLength(0)
  flushSync(() => root!.render(<Rows element={element} ids={[{ id: 'older' }, ...next]} />))
  expect(element.querySelectorAll('[data-entering]')).toHaveLength(0)
})
