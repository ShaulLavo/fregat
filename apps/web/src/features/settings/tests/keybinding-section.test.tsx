import { getClient } from '@/lib/client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach } from 'vitest'

import { fetchSettings, saveSettings } from '@/features/settings/utils/api'

import { KeybindingSection } from '../components/keybinding-section'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const SEARCH = 'Search keyboard shortcuts'

// happy-dom has no layout, and the virtualizer renders no rows while its scroller measures zero.
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.slot === 'virtual-list' ? 2000 : 0
    },
  })
})

afterEach(() => {
  if (originalOffsetHeight)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
})

function row(command: string) {
  const element = document.querySelector<HTMLElement>(`[data-shortcut-command="${command}"]`)
  expect(element).not.toBeNull()
  return element as HTMLElement
}

async function showOnly(query: string) {
  await userEvent.type(await screen.findByLabelText(SEARCH), query)
}

async function overrides() {
  return (await fetchSettings(undefined, getClient())).values['keybindings.overrides']
}

function press(
  target: HTMLElement,
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean } = {},
) {
  fireEvent.keyDown(target, {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
  })
}

test('lists commands by title, with their keys, where and source', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await showOnly('Show command palette')

  const palette = row('workspace.showCommandPalette')
  expect(palette).toHaveTextContent('Show command palette')
  expect(palette).toHaveTextContent('Everywhere')
  expect(palette).toHaveTextContent('Default')
  // F1 is its second chord; the row shows the first and counts the rest.
  expect(palette).toHaveTextContent('+1')
})

test('the search box narrows the list and says so when nothing matches', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await showOnly('sidebar')

  expect(screen.getByText('Toggle sidebar')).toBeDefined()
  expect(document.querySelector('[data-shortcut-command="workspace.saveFile"]')).toBeNull()

  await userEvent.clear(screen.getByLabelText(SEARCH))
  await showOnly('zzznope')
  expect(screen.getByText('No commands match this search.')).toBeDefined()
})

test('recording writes nothing until Enter, then Reset takes the override out', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await showOnly('Save')

  fireEvent.doubleClick(row('workspace.saveFile'))
  const recorder = await screen.findByRole('textbox', { name: 'Press the new shortcut for Save' })
  press(recorder, 'j', { ctrl: true, alt: true })
  expect(await overrides()).not.toHaveProperty('workspace.saveFile')

  press(recorder, 'Enter')
  await waitFor(async () => expect((await overrides())['workspace.saveFile']).toBe('Mod+Alt+J'))

  fireEvent.contextMenu(row('workspace.saveFile'))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset to default' }))
  await waitFor(async () => expect(await overrides()).not.toHaveProperty('workspace.saveFile'))
})

test('shows the command a chord would take before saving it', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await showOnly('Save')

  fireEvent.doubleClick(row('workspace.saveFile'))
  const recorder = await screen.findByRole('textbox', { name: 'Press the new shortcut for Save' })
  press(recorder, 'p', { ctrl: true })

  expect(await screen.findByText('Used by 1 command')).toBeDefined()
  expect(screen.getByText('Saving takes the shortcut from it.')).toBeDefined()
  expect(await overrides()).not.toHaveProperty('workspace.saveFile')
})

test('records two strokes, and Escape clears before it closes', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await showOnly('Save')

  fireEvent.doubleClick(row('workspace.saveFile'))
  const recorder = await screen.findByRole('textbox', { name: 'Press the new shortcut for Save' })
  press(recorder, 'x', { ctrl: true })
  press(recorder, 'Escape')
  expect(recorder).toHaveTextContent('Press the keys')
  press(recorder, 'k', { ctrl: true })
  press(recorder, 's', { ctrl: true })
  press(recorder, 'Enter')

  await waitFor(async () => expect((await overrides())['workspace.saveFile']).toBe('Mod+K Mod+S'))
})

test('Remove shortcut writes null, which the row shows as Removed', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await showOnly('Save')

  fireEvent.contextMenu(row('workspace.saveFile'))
  await userEvent.click(await screen.findByRole('menuitem', { name: /^Remove shortcut/ }))

  await waitFor(async () => expect((await overrides())['workspace.saveFile']).toBeNull())
  await waitFor(() => expect(row('workspace.saveFile')).toHaveTextContent('Removed'))
})

test('an untouched row offers nothing to reset', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await showOnly('Save')

  fireEvent.contextMenu(row('workspace.saveFile'))
  const reset = await screen.findByRole('menuitem', { name: 'Reset to default' })
  expect(reset).toHaveAttribute('aria-disabled', 'true')
})

test('the Custom filter counts and shows changed commands', async ({ client }) => {
  expect(client).toBeDefined()
  await saveSettings(
    {
      mutationId: 'shortcuts-custom-filter',
      operations: [{ command: 'workspace.saveFile', keys: 'Mod+Alt+J', kind: 'keybinding.set' }],
      target: 'user',
    },
    getClient(),
  )
  renderWithProviders(<KeybindingSection />)

  const custom = await screen.findByRole('tab', { name: /Custom/ })
  await waitFor(() => expect(custom).toHaveTextContent('1'))
  await userEvent.click(custom)
  const list = screen.getByRole('listbox', { name: 'Keyboard shortcuts' })
  await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(1))
  expect(row('workspace.saveFile')).toHaveTextContent('Custom')
})

test('VS Code mode lists the bindings it cannot carry', async ({ client }) => {
  expect(client).toBeDefined()
  await saveSettings(
    {
      mutationId: 'shortcuts-vscode-preset',
      operations: [{ kind: 'set', key: 'keybindings.preset', value: 'vscode' }],
      target: 'user',
    },
    getClient(),
  )
  renderWithProviders(<KeybindingSection />)

  await userEvent.click(await screen.findByText('VS Code shortcuts not available here'))
  expect(await screen.findByText('workbench.action.quickOpenPreviousEditor')).toBeDefined()
})
