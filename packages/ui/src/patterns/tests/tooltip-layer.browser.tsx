import '@workspace/ui/globals.css'
import { act } from 'react'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Button } from '@workspace/ui/components/button'
import { TooltipLayer } from '@workspace/ui/patterns/tooltip-layer'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

it('keeps a delegated tooltip readable while it closes', async () => {
  cleanups.push(
    mount(
      <>
        <TooltipLayer />
        <Button data-tooltip='Stage file'>Stage</Button>
      </>,
    ).unmount,
  )
  await page.getByRole('button', { name: 'Stage', exact: true }).hover()
  await expect
    .element(page.getByText('Stage file', { exact: true }))
    .toHaveTextContent('Stage file')

  act(() => document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })))
  const popup = document.querySelector('[data-slot="tooltip-content"]')
  expect(popup).not.toBeNull()
  expect(popup?.hasAttribute('data-closed')).toBe(true)
  expect(popup?.textContent).toBe('Stage file')
  await expect.element(page.getByText('Stage file', { exact: true })).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'Stage', exact: true }).hover()
  await expect.element(page.getByText('Stage file', { exact: true })).toBeVisible()
})
