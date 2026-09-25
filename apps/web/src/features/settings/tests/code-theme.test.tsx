import { getClient } from '@/lib/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { SettingsPage } from '@/features/settings/components/page'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import {
  clearEditorThemePreview,
  getCommittedEditorThemeId,
  getSelectedEditorThemeId,
  previewEditorTheme,
} from '@/features/editor/state/color-theme-store'
import { fetchSettings } from '@/features/settings/utils/api'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { dismissSaveError } from '@/features/settings/utils/notify-save-error'

// The whole settings page renders here; a shared CI runner takes about 6x a workstation.
const SLOW_RENDER_TIMEOUT_MS = 60_000

test(
  'settings saves native code themes per mode and reset restores the editor default',
  async ({ client }) => {
    expect(client).toBeDefined()
    renderWithProviders(<SettingsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Code theme in dark mode' }))
    expect(screen.queryByRole('option', { name: /^Native Light/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: /^Native Dark/ }))

    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, getClient())
      expect(snapshot.values['editor.codeTheme.dark']).toBe('tree-sitter-dark')
      expect(snapshot.values['editor.codeTheme.light']).toBe('light-plus')
      expect(getCommittedEditorThemeId('dark')).toBe('tree-sitter-dark')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Code theme in light mode' }))
    expect(screen.queryByRole('option', { name: /^Native Dark/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: /^Native Light/ }))

    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, getClient())
      expect(snapshot.values['editor.codeTheme.light']).toBe('tree-sitter-light')
      expect(snapshot.values['editor.codeTheme.dark']).toBe('tree-sitter-dark')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Actions for editor.codeTheme.dark' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset setting' }))

    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, getClient())
      expect(snapshot.values['editor.codeTheme.dark']).toBe('dark-plus')
      expect(snapshot.values['editor.codeTheme.light']).toBe('tree-sitter-light')
      expect(getCommittedEditorThemeId('dark')).toBe('dark-plus')
    })
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test('browsing and filtering code themes can be canceled without saving either mode', async ({
  controlledClient,
}) => {
  const before = await fetchSettings(undefined, getClient())
  const user = userEvent.setup()
  renderWithProviders(<SettingsPage />)

  for (const mode of ['dark', 'light'] as const) {
    await user.click(await screen.findByRole('button', { name: `Code theme in ${mode} mode` }))
    const search = await screen.findByRole('combobox', { name: `Search ${mode} code themes` })
    await user.type(search, 'native')
    const native = await screen.findByRole('option', {
      name: mode === 'dark' ? /^Native Dark/ : /^Native Light/,
    })
    await user.hover(native)
    await user.keyboard('{ArrowDown}')
    expect(controlledClient.controller.settingsWriteCount).toBe(0)

    await user.clear(search)
    await user.type(search, 'no-matching-theme-name')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(search).not.toBeInTheDocument())
  }

  const after = await fetchSettings(undefined, getClient())
  expect(after.values['editor.codeTheme.dark']).toBe(before.values['editor.codeTheme.dark'])
  expect(after.values['editor.codeTheme.light']).toBe(before.values['editor.codeTheme.light'])
  expect(controlledClient.controller.settingsWriteCount).toBe(0)
})

test('searching and selecting an imported theme saves only its mode', async ({
  controlledClient,
}) => {
  const user = userEvent.setup()
  const before = await fetchSettings(undefined, getClient())
  renderWithProviders(<SettingsPage />)

  await user.click(await screen.findByRole('button', { name: 'Code theme in dark mode' }))
  const search = await screen.findByRole('combobox', { name: 'Search dark code themes' })
  await user.type(search, 'monokai')
  expect(screen.queryByRole('option', { name: /^Native Dark/ })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('option', { name: /^Monokai$/ }))

  await waitFor(async () => {
    const after = await fetchSettings(undefined, getClient())
    expect(after.values['editor.codeTheme.dark']).toBe('monokai')
    expect(after.values['editor.codeTheme.light']).toBe(before.values['editor.codeTheme.light'])
    expect(controlledClient.controller.settingsWriteCount).toBe(1)
  })
  expect(search).not.toBeInTheDocument()
})

test('palette code-theme actions use settings while canceled previews do not persist', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const holder: { selectTheme?: ReturnType<typeof useEditorColorTheme>['selectTheme'] } = {}
  renderWithProviders(
    <ThemeProbe
      onTheme={(selectTheme) => {
        holder.selectTheme = selectTheme
      }}
    />,
  )
  await waitFor(() => expect(getCommittedEditorThemeId('dark')).toBe('dark-plus'))

  act(() => previewEditorTheme('dark', 'tree-sitter-dark'))
  expect(getSelectedEditorThemeId('dark')).toBe('tree-sitter-dark')
  expect((await fetchSettings(undefined, getClient())).values['editor.codeTheme.dark']).toBe(
    'dark-plus',
  )
  act(() => clearEditorThemePreview())
  expect(getSelectedEditorThemeId('dark')).toBe('dark-plus')

  act(() => {
    holder.selectTheme?.('monokai', 'command-palette')
  })
  await waitFor(async () => {
    expect((await fetchSettings(undefined, getClient())).values['editor.codeTheme.dark']).toBe(
      'monokai',
    )
    expect(readSettingsMirror()['editor.codeTheme.dark']).toBe('monokai')
    expect(getCommittedEditorThemeId('dark')).toBe('monokai')
  })
})

test('a rejected code-theme save restores the confirmed theme after preview closes', async ({
  controlledClient,
}) => {
  controlledClient.controller.rejectNextSettingsWrite({
    code: 'settings.WRITE_INVALID',
    message: 'Injected final rejection',
    status: 400,
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  const holder: {
    selectTheme?: ReturnType<typeof useEditorColorTheme>['selectTheme']
    submission?: SettingsSubmission
  } = {}
  renderWithProviders(
    <ThemeProbe
      onTheme={(selectTheme) => {
        holder.selectTheme = selectTheme
      }}
    />,
    { queryClient },
  )

  act(() => {
    previewEditorTheme('dark', 'tree-sitter-dark')
    holder.submission = holder.selectTheme?.('tree-sitter-dark', 'command-palette')
    clearEditorThemePreview()
  })
  expect(getSelectedEditorThemeId('dark')).toBe('tree-sitter-dark')
  const submission = holder.submission
  expect(submission?.kind).toBe('submitted')
  if (submission?.kind !== 'submitted') return

  await expect(submission.settled).resolves.toBe('failed')
  await waitFor(() => {
    expect(getSelectedEditorThemeId('dark')).toBe('dark-plus')
    expect(readSettingsMirror()['editor.codeTheme.dark']).toBe('dark-plus')
  })
  dismissSaveError(submission.mutationId)
})

function ThemeProbe({
  onTheme,
}: {
  readonly onTheme: (selectTheme: ReturnType<typeof useEditorColorTheme>['selectTheme']) => void
}) {
  const { selectTheme, committedThemeId } = useEditorColorTheme()
  onTheme(selectTheme)
  return <output>{committedThemeId}</output>
}
