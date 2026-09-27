import { act, render, screen } from '@testing-library/react'
import { test, expect } from '../../../../test/fixtures'
import { stubIntersectionObserver } from '../../../../test/env/intersection-observer'
import { useShown } from '@/lib/appearance/hooks/use-shown'

function ShownElement() {
  const [ref, shown] = useShown<HTMLDivElement>()
  return (
    <div ref={ref} data-testid='observed'>
      {String(shown)}
    </div>
  )
}

test('starts false and stays false for a non-intersecting element', async () => {
  const observers = stubIntersectionObserver()
  render(<ShownElement />)
  const element = screen.getByTestId('observed')
  expect(element).toHaveTextContent('false')
  const observer = observers[0]
  expect(observer).toBeDefined()
  expect(observer?.targets.has(element)).toBe(true)
  await act(async () => {})
  expect(element).toHaveTextContent('false')
  expect(observer?.disconnect).not.toHaveBeenCalled()
})

test('becomes true when the observed element intersects', () => {
  const observers = stubIntersectionObserver()
  render(<ShownElement />)
  const element = screen.getByTestId('observed')
  act(() => observers[0]?.report(element, true))
  expect(element).toHaveTextContent('true')
})

test('disconnects after the first match and stays shown across renders', () => {
  const observers = stubIntersectionObserver()
  const view = render(<ShownElement />)
  const element = screen.getByTestId('observed')
  const observer = observers[0]
  act(() => observer?.report(element, true))
  expect(observer?.disconnect).toHaveBeenCalledTimes(1)
  expect(observer?.targets.size).toBe(0)
  act(() => observer?.report(element, false))
  view.rerender(<ShownElement />)
  expect(element).toHaveTextContent('true')
  expect(observers).toHaveLength(1)
})

test('disconnects on unmount before the element intersects', () => {
  const observers = stubIntersectionObserver()
  const view = render(<ShownElement />)
  const observer = observers[0]
  expect(observer?.disconnect).not.toHaveBeenCalled()
  view.unmount()
  expect(observer?.disconnect).toHaveBeenCalledTimes(1)
  expect(observer?.targets.size).toBe(0)
})

test('works when the element starts on screen', async () => {
  const observers = stubIntersectionObserver(true)
  render(<ShownElement />)
  await act(async () => {})
  expect(screen.getByTestId('observed')).toHaveTextContent('true')
  expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1)
})
