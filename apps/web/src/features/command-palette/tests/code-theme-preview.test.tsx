import { getClient } from '@/lib/client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { CommandPalette } from '@/components/command-palette'
import { fetchSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

test('code theme sample follows highlighted rows and labels a retained sample after an empty search', async ({
  controlledClient,
}) => {
  const before = await fetchSettings(undefined, getClient())
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), before)
  renderWithProviders(
    <TestEditorStateProvider>
      <CommandPalette />
    </TestEditorStateProvider>,
    {
      application: createTestApplicationRuntime(),
      command: { paletteOpen: true, paletteSearch: 'theme ' },
      queryClient,
    },
  )
  const user = userEvent.setup()
  const input = await screen.findByRole('combobox')
  const sample = screen.getByRole('region', { name: 'Code theme sample' })
  expect(sample.closest('[cmdk-list]')).toBeNull()

  await user.hover(screen.getByRole('option', { name: 'Monokai' }))
  await waitFor(() => expect(within(sample).getByText('Monokai')).toBeInTheDocument())
  expect(within(sample).getByText('Preview')).toBeInTheDocument()
  await waitFor(() =>
    expect(sample.querySelector('pre[data-theme-id="monokai"]')).toBeInTheDocument(),
  )
  expect(controlledClient.controller.settingsWriteCount).toBe(0)

  await user.keyboard('{ArrowDown}')
  const highlightedName = screen
    .getByRole('option', { selected: true })
    .querySelector('span')?.textContent
  expect(highlightedName).not.toBe('Monokai')
  await waitFor(() => expect(within(sample).getByText(highlightedName!)).toBeInTheDocument())

  await user.type(input, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzz')
  expect(screen.getByText('No matching code themes')).toBeInTheDocument()
  expect(within(sample).getByText('Last preview')).toBeInTheDocument()
  expect(controlledClient.controller.settingsWriteCount).toBe(0)

  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Code theme sample' })).toBeNull(),
  )
  expect((await fetchSettings(undefined, getClient())).values['editor.codeTheme.dark']).toBe(
    before.values['editor.codeTheme.dark'],
  )
})
