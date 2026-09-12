import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { screen, waitFor, within } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'

import { CommandPalette } from '@/components/command-palette'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { writeRootFolderCache } from '@/features/workspace/state/cache'
import { useCommand } from '@/keymap/hooks/use-command'
import { TestCommandProvider } from '../../../../test/factories/command-runtime'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test.beforeEach(() => {
  writeRootFolderCache(testScopedStorage, null)
})

test.afterEach(() => {
  writeRootFolderCache(testScopedStorage, null)
})

test('a sub-picker opens on an empty input under its own scope chip', async () => {
  const user = userEvent.setup()
  renderPalette()

  await openColorThemePicker(user)

  expect(await screen.findByText('Code theme')).toBeInTheDocument()
  expect(await themeInput()).toHaveValue('')
})

test('typing filters the sub-picker, and deleting it back to empty stays inside', async () => {
  const user = userEvent.setup()
  renderPalette()

  await openColorThemePicker(user)
  const input = await themeInput()
  await user.type(input, 'monokai')

  await waitFor(() => expect(screen.queryByText('Dark Plus')).toBeNull())
  expect(within(screen.getByRole('listbox')).getByText('Monokai')).toBeInTheDocument()

  // The bug this guards: the mode used to live in the input as the text `theme `,
  // so deleting a query one character at a time walked straight out of the picker.
  await user.clear(input)

  expect(await screen.findByText('Dark Plus')).toBeInTheDocument()
  expect(screen.getByText('Code theme')).toBeInTheDocument()
})

test('backspace on the empty input pops back to the command list', async () => {
  const user = userEvent.setup()
  renderPalette()

  await openColorThemePicker(user)
  await user.type(await themeInput(), '{Backspace}')

  await waitFor(() => expect(screen.queryByText('Code theme')).toBeNull())
  expect(await screen.findByPlaceholderText('Search commands…')).toHaveValue('>')
})

async function openColorThemePicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open command palette' }))
  await user.click(await screen.findByText('Choose code theme'))
}

function themeInput() {
  return screen.findByPlaceholderText(/Select a code theme/)
}

function renderPalette() {
  renderWithProviders(
    <EditorStateProvider>
      <PaletteRuntime />
    </EditorStateProvider>,
    { application: createTestApplicationRuntime(), command: false },
  )
}

function PaletteRuntime() {
  const queryClient = useQueryClient()

  return (
    <TestCommandProvider queryClient={queryClient}>
      <PaletteOpener />
      <CommandPalette />
    </TestCommandProvider>
  )
}

function PaletteOpener() {
  const { bus } = useCommand()

  return (
    <button
      onClick={() =>
        bus.dispatch('workspace.showCommandPalette', {
          source: { caller: 'palette-scope-test', kind: 'programmatic' },
        })
      }
      type='button'
    >
      Open command palette
    </button>
  )
}
