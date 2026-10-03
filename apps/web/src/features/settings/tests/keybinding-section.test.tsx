import { getClient } from '@/lib/client'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

function row(command: string, keys?: string) {
  const chord = keys === undefined ? '' : `[data-shortcut-keys="${keys}"]`
  const element = document.querySelector<HTMLElement>(
    `[data-shortcut-command="${command}"]${chord}`,
  )
  expect(element).not.toBeNull()
  if (!element) expect.fail('Missing shortcut row')
  return element
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

test('records a context before writing, then resets only that context', async ({ client }) => {
  expect(client).toBeDefined()
  await saveSettings(
    {
      mutationId: 'ui-other-context',
      target: 'user',
      operations: [
        {
          kind: 'keybinding.set',
          command: 'workspace.saveFile',
          keys: ['F6', 'F7'],
          context: 'Workspace',
        },
      ],
    },
    client,
  )
  renderWithProviders(<KeybindingSection />)
  await showOnly('workspace.saveFile')
  await waitFor(() =>
    expect(document.querySelector('[data-shortcut-command="workspace.saveFile"]')).not.toBeNull(),
  )
  fireEvent.doubleClick(row('workspace.saveFile', 'F6'))
  const recorder = await screen.findByRole('textbox', { name: 'Press the new shortcut for Save' })
  const predicate = screen.getByLabelText('Shortcut context')
  await userEvent.clear(predicate)
  await userEvent.type(predicate, 'Terminal && mode == alternate')
  press(recorder, 'j', { ctrl: true, alt: true })
  expect(
    (await overrides()).filter((entry) => entry.context === 'Terminal && mode == alternate'),
  ).toEqual([])
  press(recorder, 'Enter')
  await waitFor(async () =>
    expect(await overrides()).toEqual(
      expect.arrayContaining([
        { keys: 'F6', command: 'workspace.saveFile', context: 'Workspace' },
        { keys: 'F7', command: 'workspace.saveFile', context: 'Workspace' },
        {
          keys: 'Mod+Alt+J',
          command: 'workspace.saveFile',
          context: 'Terminal && mode == alternate',
        },
      ]),
    ),
  )
  const customized = document.querySelector<HTMLElement>(
    '[data-shortcut-command="workspace.saveFile"][data-shortcut-keys="Mod+Alt+J"]',
  )
  if (!customized) expect.fail('Missing saved contextual shortcut')
  fireEvent.contextMenu(customized)
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset to default' }))
  await waitFor(async () =>
    expect(await overrides()).toEqual([
      { keys: 'F6', command: 'workspace.saveFile', context: 'Workspace' },
      { keys: 'F7', command: 'workspace.saveFile', context: 'Workspace' },
    ]),
  )
  fireEvent.doubleClick(row('workspace.saveFile', 'F6'))
  await userEvent.clear(await screen.findByLabelText('Shortcut context'))
  const rootRecorder = screen.getByRole('textbox', {
    name: 'Press the new shortcut for Save',
  })
  press(rootRecorder, 'F8')
  press(rootRecorder, 'Enter')
  await waitFor(async () =>
    expect(await overrides()).toEqual([
      { keys: 'F6', command: 'workspace.saveFile', context: 'Workspace' },
      { keys: 'F7', command: 'workspace.saveFile', context: 'Workspace' },
      { keys: 'F8', command: 'workspace.saveFile' },
    ]),
  )
})

test('refuses malformed recorder context and allows saving a valid one', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await showOnly('workspace.saveFile')
  fireEvent.doubleClick(row('workspace.saveFile'))
  const recorder = await screen.findByRole('textbox', { name: 'Press the new shortcut for Save' })
  press(recorder, 'j', { ctrl: true, alt: true })
  await userEvent.clear(screen.getByLabelText('Shortcut context'))
  await userEvent.type(screen.getByLabelText('Shortcut context'), 'Editor &&')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(await overrides()).toEqual([])
})

test('adds a null reservation, a targeted unbind and deletes one authored entry', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<KeybindingSection />)
  await userEvent.click(await screen.findByText(/Authored bindings and reservations/))
  await userEvent.type(screen.getByLabelText('Authored binding keys'), 'F8')
  await userEvent.type(screen.getByLabelText('Authored binding context'), 'Terminal')
  await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
  await waitFor(async () =>
    expect(await overrides()).toEqual([{ keys: 'F8', command: null, context: 'Terminal' }]),
  )
  await userEvent.click(screen.getByLabelText('Binding entry kind'))
  await userEvent.click(await screen.findByRole('option', { name: 'Unbind command' }))
  await userEvent.type(screen.getByLabelText('Authored binding keys'), 'F9')
  await userEvent.type(screen.getByLabelText('Command to unbind'), 'future.command')
  await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
  await waitFor(async () =>
    expect(await overrides()).toEqual([
      { keys: 'F8', command: null, context: 'Terminal' },
      { keys: 'F9', unbind: 'future.command', context: 'Terminal' },
    ]),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Delete authored binding 1' }))
  await waitFor(async () =>
    expect(await overrides()).toEqual([
      { keys: 'F9', unbind: 'future.command', context: 'Terminal' },
    ]),
  )
})
