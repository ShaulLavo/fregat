import '@testing-library/jest-dom/vitest'
import { screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useElementWidth } from '@/hooks/use-element-width'
import { renderWithProviders } from '../../../../test/render'

const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

describe('useElementWidth', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        const width = this.getAttribute('data-test-width')
        if (!width) return 0

        return Number(width)
      },
    })
  })

  afterEach(() => {
    if (!clientWidthDescriptor) return

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
  })

  it('retries when the referenced element is attached after the first layout effect', async () => {
    renderWithProviders(<DelayedElementWidthProbe />)

    await waitFor(() => {
      expect(screen.getByTestId('width')).toHaveTextContent('460')
    })
  })
})

function DelayedElementWidthProbe() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [attached, setAttached] = useState(false)
  const width = useElementWidth(ref)

  useEffect(() => {
    // Attaching the measured element on a later render is the scenario under test:
    // it exercises useElementWidth's rAF retry when the ref is empty on first layout.
    // Setting state in the effect is the point of the probe, not an anti-pattern.
    // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect
    setAttached(true)
  }, [])

  return (
    <>
      <output data-testid='width'>{width ?? 'null'}</output>
      {attached ? <div data-test-width='460' ref={ref} /> : null}
    </>
  )
}
