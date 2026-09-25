import { getClient } from '@/lib/client'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { formatChord } from '@/keymap/utils/format-keys'

import { KeybindingSection } from '../components/keybinding-section'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const SAVE_RECORDER = 'Record a shortcut for workspace.saveFile'

// The regression the whole plan exists to fix: the control this replaces made
// the user type `workspace.saveFile` from memory before it showed a recorder.
test('lists commands by title rather than by id', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)

  expect(await screen.findByText('Save')).toBeDefined()
  expect(screen.getByRole('button', { name: SAVE_RECORDER })).toBeDefined()
})

test('the search box narrows the list', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  expect(await screen.findByRole('button', { name: SAVE_RECORDER })).toBeDefined()

  await userEvent.type(screen.getByLabelText('Search keyboard shortcuts'), 'sidebar')

  expect(screen.queryByRole('button', { name: SAVE_RECORDER })).toBeNull()
  expect(screen.getByText('Toggle sidebar')).toBeDefined()
})

test('records and resets a command omitted by the default preset', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await screen.findByRole('button', { name: SAVE_RECORDER })
  await userEvent.type(screen.getByLabelText('Search keyboard shortcuts'), 'Find references')

  const recorderName = 'Record a shortcut for editor.editor.action.goToReferences'
  const recorder = screen.getByRole('button', { name: recorderName })
  expect(screen.getByRole('button', { name: 'Unbind Find references' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await userEvent.click(recorder)
  fireEvent.keyDown(recorder, { key: 'F12', shiftKey: true })

  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['keybindings.overrides']['editor.editor.action.goToReferences']).toBe(
      'Shift+F12',
    )
  })
  await userEvent.click(screen.getByRole('button', { name: 'Reset Find references' }))

  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['keybindings.overrides']).not.toHaveProperty(
      'editor.editor.action.goToReferences',
    )
  })
  expect(screen.getByRole('button', { name: recorderName })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Unbind Find references' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('says so when nothing matches', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  expect(await screen.findByRole('button', { name: SAVE_RECORDER })).toBeDefined()

  await userEvent.type(screen.getByLabelText('Search keyboard shortcuts'), 'zzznope')

  expect(screen.getByText('No commands match this search.')).toBeDefined()
})

// The negative of the write test: a Reset button wired to always-enabled would
// still pass that one.
test('an untouched row offers nothing to undo', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)

  expect(await screen.findByRole('button', { name: 'Reset Save' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.queryByText('Custom')).toBeNull()
})

test('recording a chord writes the override through, and Reset takes it back out', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)

  const recorder = await screen.findByRole('button', { name: SAVE_RECORDER })
  await userEvent.click(recorder)
  fireEvent.keyDown(recorder, { altKey: true, key: 'j', metaKey: true })

  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['keybindings.overrides']['workspace.saveFile']).toBe('Mod+Alt+J')
  })

  await userEvent.click(await screen.findByRole('button', { name: 'Reset Save' }))

  // `saveCollection` sends no value once the record is back at the registry
  // default, so the key leaves the user file entirely rather than becoming null.
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['keybindings.overrides']).not.toHaveProperty('workspace.saveFile')
  })
})

// `null` is "this command has no shortcut"; an absent key is "use the default".
// toBeNull, not toBeFalsy — an absent key is falsy too, and is the other one.
test('Unbind writes null rather than removing the key', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)

  await userEvent.click(await screen.findByRole('button', { name: 'Unbind Save' }))

  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['keybindings.overrides']['workspace.saveFile']).toBeNull()
  })
})

test('records two strokes through the server and renders the saved shortcut as glyphs', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  const recorder = await screen.findByRole('button', { name: SAVE_RECORDER })
  await userEvent.click(recorder)
  fireEvent.keyDown(recorder, { ctrlKey: true, key: 'k' })

  expect(
    (await fetchSettings(undefined, getClient())).values['keybindings.overrides'],
  ).not.toHaveProperty('workspace.saveFile')
  fireEvent.keyDown(recorder, { ctrlKey: true, key: 's' })

  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['keybindings.overrides']['workspace.saveFile']).toBe('Mod+K Mod+S')
  })
  await waitFor(() => expect(recorder.textContent).toBe(formatChord('Mod+K Mod+S')))
})

test('reads the selected preset before showing shortcut rows', async ({ client }) => {
  expect(client).toBeDefined()
  await saveSettings(
    {
      mutationId: 'keybinding-vscode-preset',
      operations: [{ kind: 'set', key: 'keybindings.preset', value: 'vscode' }],
      target: 'user',
    },
    getClient(),
  )
  renderWithProviders(<KeybindingSection />)
  const recorder = await screen.findByRole('button', {
    name: 'Record a shortcut for editor.editor.fold',
  })
  const fold = defaultPlatformKeyBindings(undefined, 'vscode').find(
    (row) => row.command === 'editor.editor.fold',
  )
  expect(fold).toBeDefined()
  await waitFor(() => expect(recorder).toHaveTextContent(formatChord(fold?.keys ?? '')))
})

test('shows reservations and preset omissions in the resolution report', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await userEvent.click(await screen.findByText('Shortcut resolution'))
  expect(screen.getByRole('list', { name: 'Shortcut resolution report' })).toHaveTextContent(
    'reservation',
  )
  expect(screen.getByRole('list', { name: 'Unmapped VS Code bindings' })).toHaveTextContent(
    'workbench.action.quickOpenPreviousEditor',
  )
  expect(screen.getByRole('list', { name: 'Preset omissions' })).toBeDefined()
})
