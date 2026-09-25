import { Fragment } from 'react'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { useWorkLogScroll } from '@/features/chat/hooks/use-work-log-scroll'
import { expect, test } from '../../../../../test/fixtures'

function WorkLog({ text, kind }: { text: string; kind: 'rows' | 'text' }) {
  const { scrollRef, rowsRef } = useWorkLogScroll(`observer-${kind}`, 1, kind)
  if (kind === 'text') return <pre ref={scrollRef}>{text}</pre>
  return (
    <div ref={scrollRef}>
      <Fragment ref={rowsRef}>
        <div data-work-log-entry-id='one'>{text}</div>
      </Fragment>
    </div>
  )
}

test('row text changes do not measure the group until its size changes', async () => {
  const view = render(<WorkLog kind='rows' text='first' />)
  const reads = vi.spyOn(Element.prototype, 'getBoundingClientRect')
  view.rerender(<WorkLog kind='rows' text='later' />)
  await new Promise((resolve) => setTimeout(resolve))
  expect(reads).not.toHaveBeenCalled()
  reads.mockRestore()
  view.unmount()
})

test('capped text still observes content changes that do not resize the box', async () => {
  const view = render(<WorkLog kind='text' text='first' />)
  const reads = vi.spyOn(Element.prototype, 'getBoundingClientRect')
  view.rerender(<WorkLog kind='text' text='later' />)
  await new Promise((resolve) => setTimeout(resolve))
  expect(reads).toHaveBeenCalled()
  reads.mockRestore()
  view.unmount()
})
