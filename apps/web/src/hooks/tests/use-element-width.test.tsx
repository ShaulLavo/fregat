import { screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'

import { useElementWidth } from '@/hooks/use-element-width'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(460)
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('measures an element attached after the first render, in that commit', () => {
  renderWithProviders(<DelayedElementWidthProbe />)

  expect(screen.getByTestId('width')).toHaveTextContent('460')
})

function DelayedElementWidthProbe() {
  const [attached, setAttached] = useState(false)
  const [ref, width] = useElementWidth<HTMLDivElement>()

  useEffect(() => {
    // Attaching on a later render is the case under test: no layout effect sees this element.
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
