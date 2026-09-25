import { act, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { paintTerminalViewport } from 'ghostty-webgpu'
import { SavedViewport } from '@/features/terminal/components/saved-viewport'

vi.mock('ghostty-webgpu', () => ({ paintTerminalViewport: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

test('geometry rejection runs once and releases the native viewport once on unmount', () => {
  const dispose = vi.fn()
  vi.mocked(paintTerminalViewport).mockReturnValue({
    lines: [],
    scrollbar: { offset: 0, length: 1, total: 1 },
    dispose,
  })
  const onRejected = vi.fn()
  const view = render(
    <SavedViewport
      paint='saved'
      fontFamily='monospace'
      fontSize={14}
      onAdmitted={vi.fn()}
      onRejected={onRejected}
    />,
  )
  const host = view.getByRole('img')
  Object.defineProperty(host, 'clientWidth', { value: 100 })
  act(() => {
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
  })
  expect(onRejected).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(dispose).toHaveBeenCalledTimes(1)
})
