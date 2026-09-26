import { act, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { FontSample } from '@/features/settings/components/widgets/font-sample'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('keeps the loaded sample text and face until the next face loads', async ({ client }) => {
  expect(client).toBeDefined()
  const loaded = Promise.withResolvers<void>()
  const failed = Promise.withResolvers<void>()
  const loads = [loaded, failed]
  class SampleFace {
    async load() {
      await loads.shift()?.promise
      return this
    }
  }
  vi.stubGlobal('FontFace', SampleFace)
  const fonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  const add = vi.fn()
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add } })
  const rendered = renderWithProviders(
    <FontSample fontRef='bundled:inter' role='ui' text='Inter' />,
  )
  try {
    const sample = await rendered.findByText('Inter')
    const style = sample.getAttribute('style')
    rendered.rerender(<FontSample fontRef='local:Next' role='ui' text='Next' />)
    expect(sample.textContent).toBe('Inter')
    expect(sample.getAttribute('style')).toBe(style)
    expect(rendered.queryByText('Next')).toBeNull()
    await act(async () => loaded.resolve())
    await waitFor(() => expect(sample.textContent).toBe('Next'))
    expect(sample.getAttribute('style')).toContain('local:Next sample Next')
    expect(add).toHaveBeenCalledOnce()
    rendered.rerender(<FontSample fontRef='local:Missing' role='ui' text='Missing' />)
    expect(sample.textContent).toBe('Next')
    await act(async () => failed.reject('Font download failed'))
    await waitFor(() => expect(sample.textContent).toBe('Missing'))
    expect(sample.getAttribute('style')).toContain('Missing')
    expect(rendered.queryByRole('status', { name: 'Loading font sample' })).toBeNull()
  } finally {
    rendered.unmount()
    vi.unstubAllGlobals()
    if (fonts) Object.defineProperty(document, 'fonts', fonts)
    else Reflect.deleteProperty(document, 'fonts')
  }
})
