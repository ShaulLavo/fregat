import { getClient } from '@/lib/client'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { CommandPalette } from '@/components/command-palette'
import { fetchSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

test('theme preview cancels without saving and selection writes the bundle', async ({
  controlledClient,
}) => {
  const before = await fetchSettings(undefined, getClient())
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), before)
  const options = {
    application: createTestApplicationRuntime(),
    command: { paletteOpen: true, paletteSearch: 'bundle sage' },
    queryClient,
  }
  const first = renderWithProviders(
    <TestEditorStateProvider>
      <CommandPalette />
    </TestEditorStateProvider>,
    options,
  )
  const user = userEvent.setup()
  await screen.findByPlaceholderText(/Select a theme/)
  await waitFor(() => expect(paletteStyle()).toContain(SAGE_LIGHT_BACKGROUND))
  expect(controlledClient.controller.settingsWriteCount).toBe(0)

  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByPlaceholderText(/Select a theme/)).toBeNull())
  await waitFor(() => expect(paletteStyle()).not.toContain(SAGE_LIGHT_BACKGROUND))
  expect(controlledClient.controller.settingsWriteCount).toBe(0)
  first.unmount()

  renderWithProviders(
    <TestEditorStateProvider>
      <CommandPalette />
    </TestEditorStateProvider>,
    options,
  )
  await user.click(await screen.findByText('Sage'))
  await waitFor(async () =>
    expect((await fetchSettings(undefined, getClient())).values['workbench.theme']?.id).toBe(
      'sage',
    ),
  )
  expect(controlledClient.controller.settingsWriteCount).toBe(1)
  expect(paletteStyle()).toContain(SAGE_LIGHT_BACKGROUND)
})

const SAGE_LIGHT_BACKGROUND = '--background-solid: oklch(0.98 0.003 90);'

function paletteStyle() {
  return document.getElementById('platform-palette')?.textContent ?? ''
}
