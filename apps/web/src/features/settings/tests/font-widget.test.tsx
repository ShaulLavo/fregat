import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { FontWidget } from '@/features/settings/components/widgets/font-widget'

const fontUi = () => document.documentElement.style.getPropertyValue('--font-ui')

test('opens on suggestions before anything is typed', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(
    <FontWidget id='workbench.fontFamily' onChange={vi.fn()} value='bundled:inter' />,
  )

  await userEvent.click(screen.getByRole('combobox', { name: 'Interface font' }))

  expect(await screen.findByText('Suggested')).toBeInTheDocument()
  expect(screen.getByRole('option', { name: /^Geist/ })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: /^System/ })).toBeInTheDocument()
})

test('searches the catalog, previews the highlighted font, and restores it on Escape', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const onChange = vi.fn()
  renderWithProviders(
    <FontWidget id='workbench.fontFamily' onChange={onChange} value='bundled:inter' />,
  )
  const saved = fontUi()

  await userEvent.click(screen.getByRole('combobox', { name: 'Interface font' }))
  await userEvent.type(screen.getByRole('combobox', { name: 'Search interface fonts' }), 'lora')
  await screen.findByRole('option', { name: /^Lora/ })
  await userEvent.keyboard('{ArrowDown}')

  await waitFor(() => expect(fontUi()).toContain('lora Fontsource'))
  await userEvent.keyboard('{Escape}')

  await waitFor(() => expect(fontUi()).toBe(saved))
  expect(onChange).not.toHaveBeenCalled()
})

test('writes the chosen font', async ({ client }) => {
  expect(client).toBeDefined()
  const onChange = vi.fn()
  renderWithProviders(
    <FontWidget id='editor.fontFamily' onChange={onChange} value='bundled:jetbrains-mono' />,
  )

  await userEvent.click(screen.getByRole('combobox', { name: 'Code font' }))
  await userEvent.type(screen.getByRole('combobox', { name: 'Search code fonts' }), 'geist')
  await userEvent.click(await screen.findByRole('option', { name: /^Geist Mono/ }))

  expect(onChange).toHaveBeenCalledWith('fontsource:geist-mono')
})

test('offers an installed font when nothing in the catalog matches', async ({ client }) => {
  expect(client).toBeDefined()
  const onChange = vi.fn()
  renderWithProviders(
    <FontWidget id='editor.fontFamily' onChange={onChange} value='bundled:jetbrains-mono' />,
  )

  await userEvent.click(screen.getByRole('combobox', { name: 'Code font' }))
  await userEvent.type(screen.getByRole('combobox', { name: 'Search code fonts' }), 'Zzyzx Mono')
  await userEvent.click(
    await screen.findByRole('option', { name: /Use installed font 'Zzyzx Mono'/ }),
  )

  expect(onChange).toHaveBeenCalledWith('local:Zzyzx Mono')
})
