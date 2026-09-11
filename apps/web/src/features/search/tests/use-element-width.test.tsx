import { screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'

import { useElementWidth } from '@/features/search/components/results-view'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(460)
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('measures a search viewport attached after the first layout effect', async () => {
  renderWithProviders(<DelayedSearchViewport />)

  await waitFor(() => expect(screen.getByTestId('width')).toHaveTextContent('460'))
})

function DelayedSearchViewport() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [attached, setAttached] = useState(false)
  const width = useElementWidth(ref)

  useEffect(() => {
    // A later render must attach the viewport to exercise the width retry.
    // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect
    setAttached(true)
  }, [])

  return (
    <>
      <output data-testid='width'>{width ?? 'null'}</output>
      {attached ? <div ref={ref} /> : null}
    </>
  )
}
