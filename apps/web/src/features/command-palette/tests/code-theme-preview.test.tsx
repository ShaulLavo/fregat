import { getClient } from '@/lib/client'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { assert } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithLoadedDialogs } from '../../../../test/render'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { CommandPalette } from '@/components/command-palette'
import { fetchSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { loadCodeThemePreview } from '@/lib/code-theme/state/preview'
import { colorThemeIdFromItemValue } from '@/features/command-palette/utils/query'

test('code theme sample follows highlighted rows and labels a retained sample after an empty search', async ({
  controlledClient,
}) => {
  const before = await fetchSettings(undefined, getClient())
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), before)
  await renderWithLoadedDialogs(
    <TestEditorStateProvider>
      <CommandPalette />
    </TestEditorStateProvider>,
    {
      application: createTestApplicationRuntime(),
      command: { paletteOpen: true, paletteSearch: 'code ' },
      queryClient,
    },
  )
  const user = userEvent.setup()
  const input = await screen.findByRole('combobox')
  const sample = screen.getByRole('region', { name: 'Code theme sample' })
  expect(sample.closest('[cmdk-list]')).toBeNull()

  await user.hover(screen.getByRole('option', { name: 'Monokai' }))
  // The label and tokens swap together after the cold Shiki query settles.
  await act(() => loadCodeThemePreview('monokai'))
  await waitFor(() => expect(within(sample).getByText('Monokai')).toBeInTheDocument())
  expect(within(sample).getByText('Preview')).toBeInTheDocument()
  expect(sample.querySelector('pre[data-theme-id="monokai"]')).toBeInTheDocument()
  expect(controlledClient.controller.settingsWriteCount).toBe(0)

  await user.keyboard('{ArrowDown}')
  const highlighted = screen.getByRole('option', { selected: true })
  const highlightedName = highlighted.querySelector('span')?.textContent
  const highlightedId = colorThemeIdFromItemValue(highlighted.getAttribute('data-value') ?? '')
  assert(highlightedName && highlightedId)
  expect(highlightedName).not.toBe('Monokai')
  await act(() => loadCodeThemePreview(highlightedId))
  await waitFor(() => expect(within(sample).getByText(highlightedName)).toBeInTheDocument())
  expect(sample.querySelector(`pre[data-theme-id="${highlightedId}"]`)).toBeInTheDocument()

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
