import { expect, test } from 'vitest'
import { mount } from '../../../test/render'
import { Ticker } from '../ticker'

test('keeps fixed precision in the visible digits and accessible label', () => {
  const view = mount(<Ticker value={-1234.5} decimals={2} />)
  try {
    const label = (-1234.5).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    expect(view.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(label)
    expect(view.container.querySelectorAll('[data-slot="ticker-digit"]')).toHaveLength(6)
    view.render(<Ticker value={0} decimals={2} />)
    expect(view.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      (0).toFixed(2),
    )
  } finally {
    view.unmount()
  }
})
