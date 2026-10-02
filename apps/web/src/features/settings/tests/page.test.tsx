import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { ensureFolderPath } from '@/lib/file-server'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import {
  documentKey,
  settingsJsonDocument,
  filesystemPath,
  tabId,
} from '@/lib/documents/utils/identity'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createEditorTextBuffer, createEditorViewSession } from '@singapore-editor/core/document'

import { getClient } from '@/lib/client'

import { renderWithProviders } from '../../../../test/render'
import { expect, test } from '../../../../test/fixtures'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { SettingsPage } from '../components/page'
import { matchingSettingIds } from '@workspace/client-core/settings/search'
import {
  createEditorWorkspaceStore,
  EditorWorkspaceStateContext,
} from '@/features/editor/state/workspace-state'
import { emptyWorkspaceState } from '@/features/workspace/state/cache'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { FocusService } from '@/lib/focus/state/service'
import { matchesActiveSurface } from '@/lib/focus/utils/active-surface'

// The whole settings page renders here; a shared CI runner takes about 6x a workstation.
const SLOW_RENDER_TIMEOUT_MS = 60_000

test.beforeEach(() => {
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsSearch('')
  selectSettingsCategory(null)
})

function planModeSwitch() {
  return screen.findByRole('switch', { name: 'Plan mode controls' })
}

test(
  'renders a row per user-visible setting and writes a toggle through',
  async ({ client }) => {
    expect(client).toBeDefined()
    renderWithProviders(<SettingsPage />)

    const planMode = await planModeSwitch()
    expect(planMode).not.toBeChecked()

    await userEvent.click(planMode)

    // Asserted against the server, not the control: the point is that the click
    // reached the settings file, not that a switch flipped locally.
    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, getClient())
      expect(snapshot.values['chat.planModeEnabled']).toBe(true)
    })
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'offers a reset once a value differs from its default',
  async ({ client }) => {
    expect(client).toBeDefined()
    renderWithProviders(<SettingsPage />)

    await userEvent.click(await planModeSwitch())

    await userEvent.click(
      await screen.findByRole('button', { name: 'Actions for chat.planModeEnabled' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset to default' }))

    // Reset removes the key rather than writing the default into the file, which
    // is what keeps the default coming from the running build.
    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, getClient())
      expect(snapshot.values['chat.planModeEnabled']).toBe(false)
      expect(snapshot.layers.find((layer) => layer.id === 'user')?.raw).not.toHaveProperty(
        'chat.planModeEnabled',
      )
    })
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'mounts every row after the first screen, down to the shortcut list',
  async ({ client }) => {
    expect(client).toBeDefined()
    const { container } = renderWithProviders(<SettingsPage />)

    await waitFor(
      () =>
        expect(container.querySelector('[data-setting-row="keybindings.overrides"]')).not.toBe(
          null,
        ),
      { timeout: SLOW_RENDER_TIMEOUT_MS },
    )
    const summary = await screen.findByText(/^\d+ settings$/)
    expect(container.querySelectorAll('[data-setting-row]')).toHaveLength(
      Number.parseInt(summary.textContent ?? '', 10),
    )
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'a second press on a row’s actions closes its menu',
  async ({ client }) => {
    expect(client).toBeDefined()
    renderWithProviders(<SettingsPage />)
    const actions = await screen.findByRole('button', { name: 'Actions for chat.planModeEnabled' })

    await userEvent.click(actions)
    await screen.findByRole('menuitem', { name: 'Copy setting ID' })
    expect(actions).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(actions)
    await waitFor(() => expect(screen.queryByRole('menu')).toBe(null))
    expect(actions).toHaveAttribute('aria-expanded', 'false')
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test('row actions support arrow-key opening and Escape focus return', async ({ client }) => {
  expect(client).toBeDefined()
  selectSettingsSearch('chat.planModeEnabled')
  renderWithProviders(<SettingsPage />)
  const actions = await screen.findByRole('button', { name: 'Actions for chat.planModeEnabled' })
  actions.focus()

  await userEvent.keyboard('{ArrowDown}')
  const copyId = await screen.findByRole('menuitem', { name: 'Copy setting ID' })
  await waitFor(() => expect(copyId).toHaveFocus())
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).toBe(null))
  expect(actions).toHaveFocus()

  await userEvent.keyboard('{ArrowUp}')
  const editJson = await screen.findByRole('menuitem', { name: 'Edit in settings.json' })
  await waitFor(() => expect(editJson).toHaveFocus())
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(actions).toHaveFocus())
})

test('filters by id, label, keyword and description', () => {
  expect(matchingSettingIds('surface.blur')).toEqual(['workbench.surface.blur'])
  // A keyword match: "transparency" appears in no id or label.
  expect(matchingSettingIds('transparency')).toContain('workbench.surface.opacity')
  expect(matchingSettingIds('nothing-matches-this')).toEqual([])
})

test('searching a key edited from another row finds the row that edits it', () => {
  // `models.order` has no row of its own, so a search for it has to answer with
  // the row that writes it. Returning the key itself would put a row on the page
  // that renders nothing; returning nothing would make the setting unfindable by
  // the only name the reference documents it under.
  expect(matchingSettingIds('models.order')).toEqual(['models.hidden'])
  expect(matchingSettingIds('models')).not.toContain('models.order')
})

test('shows a diagnostic for an unknown key preserved in workspace settings', async ({
  server,
  client,
}) => {
  expect(client).toBeDefined()
  const workspaceFile = path.join(server.root, '.platform', 'settings.json')
  await mkdir(path.dirname(workspaceFile), { recursive: true })
  await writeFile(workspaceFile, '{ "editor.fromANewerBuild": true }')
  await server.restart()

  renderWithProviders(<SettingsPage />)

  expect(await screen.findByText(/not applied/)).toBeDefined()
  expect(await screen.findByText('editor.fromANewerBuild')).toBeDefined()
})

test('reset all clears every key from the layer in one write', async ({ client }) => {
  expect(client).toBeDefined()
  await saveSettings(
    {
      mutationId: 'page-reset-all-seed',
      operations: [
        { key: 'workbench.colorTheme', kind: 'set', value: 'light' },
        { key: 'workbench.surface.opacity', kind: 'set', value: 40 },
      ],
      target: 'user',
    },
    getClient(),
  )

  renderWithProviders(<SettingsPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Settings actions' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Reset all/ }))

  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    // Removed, not overwritten with defaults: what is in the file is what the
    // user changed, so a default that moves in a later build still applies.
    expect(snapshot.layers.find((layer) => layer.id === 'user')?.raw).toEqual({})
    expect(snapshot.values['workbench.colorTheme']).toBe('system')
  })
})

test(
  'refuses an application-scoped key from the workspace tab, and says why',
  async ({ client }) => {
    expect(client).toBeDefined()
    await ensureFolderPath(filesystemPath('repo'), client)
    const workspaceAddress = await registerTestWorkspaceAddress(client, 'repo')
    // The Workspace tab is gated on a folder being open, so the page needs a
    // workspace store with a root for the tab to be reachable at all.
    const store = createEditorWorkspaceStore({
      ...emptyWorkspaceState(),
      rootFolder: {
        workspaceAddress,
        birthtimeMs: 0,
        mtimeMs: 0,
        name: 'repo',
        path: filesystemPath('repo'),
        size: 0,
        type: 'directory',
        version: '',
      },
    })
    renderWithProviders(
      <EditorWorkspaceStateContext.Provider value={store}>
        <SettingsPage />
      </EditorWorkspaceStateContext.Provider>,
    )

    await userEvent.click(await screen.findByRole('tab', { name: 'Workspace' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Search settings' }), 'runtime')
    // The scope rule surfaces where the user meets it rather than only as a
    // server error after a failed save.
    expect(
      await screen.findByText(/^application settings can only be set in User settings$/),
    ).toBeDefined()
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'renders a real providers editor rather than a JSON escape hatch',
  async ({ client }) => {
    expect(client).toBeDefined()
    renderWithProviders(<SettingsPage />)

    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Search settings' }),
      'providers',
    )

    // The built-in providers live in the registry as constants, not in the
    // settings document, so the row has to source them from the running snapshots.
    // Before this the page showed "Edit in settings.json" for the one screen whose
    // whole job is configuring providers.
    expect(screen.queryByText('Edit in settings.json')).toBeNull()
    const switches = await screen.findAllByRole(
      'switch',
      { name: /Enable/ },
      { timeout: SLOW_RENDER_TIMEOUT_MS },
    )
    expect(switches.length).toBeGreaterThan(0)
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test('lists the real model catalog, and hiding one keeps its row to bring it back', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsPage />)

  await userEvent.type(await screen.findByRole('textbox', { name: 'Search settings' }), 'models')

  // Same defect as the providers section, one screen over: settings remember the
  // models you have an opinion about, so listing those meant the screen for
  // forming an opinion started empty.
  const switches = await screen.findAllByRole('switch', { name: /Show / })
  expect(switches.length).toBeGreaterThan(0)

  const first = switches[0]
  expect(first).toBeDefined()
  const label = first!.getAttribute('aria-label')
  await userEvent.click(first!)

  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['models.hidden']).toHaveLength(1)
  })

  // The row survives the toggle, unchecked. If hiding removed it, the switch
  // that un-hides it would go with it and the model would be hidden for good.
  const after = await screen.findByRole('switch', { name: label! })
  expect(after).not.toBeChecked()
})

test('hiding and ordering models are one row, not the catalogue printed twice', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsPage />)

  await userEvent.type(await screen.findByRole('textbox', { name: 'Search settings' }), 'models')

  // One row, named for the decision rather than for the denylist that stores it.
  // "Hidden" over switches that are *on* for the models you can see reads as a
  // contradiction, and it was one row per key that forced the name.
  expect(await screen.findByText('Models', { selector: 'label' })).toBeDefined()
  expect(screen.queryByText('Hidden')).toBeNull()
  expect(screen.queryByText('Order')).toBeNull()
  expect(await screen.findByText('1 setting')).toBeDefined()

  // Both keys are still named on the row. The title is free to say "Models" only
  // because the ids say which lines of settings.json this row writes.
  expect(await screen.findByText('models.hidden')).toBeDefined()
  expect(await screen.findByText('models.order')).toBeDefined()

  // Both controls on the same line, so hiding and ranking a model are taken
  // where the model is rather than in two lists the user has to align by eye.
  const shown = await screen.findAllByRole('switch', { name: /Show / })
  const moves = await screen.findAllByRole('button', { name: /Move .* down/ })
  expect(moves.length).toBe(shown.length)
})

test('a collection edited back to empty leaves no key behind to look modified', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsPage />)

  await userEvent.type(await screen.findByRole('textbox', { name: 'Search settings' }), 'models')

  const first = (await screen.findAllByRole('switch', { name: /Show / }))[0]
  expect(first).toBeDefined()
  const label = first!.getAttribute('aria-label')
  await userEvent.click(first!)
  await waitFor(async () => {
    expect((await fetchSettings(undefined, getClient())).values['models.hidden']).toHaveLength(1)
  })

  await userEvent.click(await screen.findByRole('switch', { name: label! }))

  // Un-hiding the last model used to write `[]` — the default, but *present*,
  // which is what the page reads as modified. The row then claimed a change it
  // could not describe and offered a Reset with nothing to remove.
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.layers.find((layer) => layer.id === 'user')?.raw).not.toHaveProperty(
      'models.hidden',
    )
  })
  expect(screen.queryByLabelText('Modified')).toBeNull()
})

test('every registered widget resolves a real control, not the JSON escape hatch', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsPage />)

  // A row has to be on screen before the absence of the hint means anything.
  await planModeSwitch()

  // The hint is the dispatch's fallback for `list`, `complex` and a value whose
  // shape does not match its widget — none of which any registered key
  // produces. One on the page means a widget kind lost its branch.
  expect(screen.queryAllByText('Edit in settings.json')).toEqual([])
})

test('Escape from a row returns focus to the search box', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsPage />)

  const planMode = await planModeSwitch()
  planMode.focus()
  expect(document.activeElement).toBe(planMode)

  await userEvent.keyboard('{Escape}')

  // One key back to the top from anywhere in the list, so a keyboard user is
  // never stranded partway down a long page.
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search settings' }))
})

test('every visible row is reachable and operable from the keyboard', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsPage />)

  await userEvent.type(await screen.findByRole('textbox', { name: 'Search settings' }), 'plan mode')
  const planMode = await planModeSwitch()

  planMode.focus()
  await userEvent.keyboard(' ')

  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['chat.planModeEnabled']).toBe(true)
  })
})

test('settings JSON exposes its nested editor as the sole active surface', async ({ client }) => {
  expect(client).toBeDefined()
  const focus = new FocusService()
  const path = documentKey(settingsJsonDocument('user'))
  const buffer = createEditorTextBuffer('{}')
  const liveDocument = {
    buffer,
    editability: 'editable' as const,
    key: path,
    target: settingsJsonDocument('user'),
    view: createEditorViewSession(buffer, 'settings-focus-test'),
  }
  selectSettingsScope('user')
  selectSettingsView('json')
  const rendered = renderWithProviders(
    <EditorStateProvider>
      <div data-workbench>
        <SettingsPage
          liveDocument={liveDocument}
          rootPath={filesystemPath('/repo')}
          tabId={tabId('settings-tab')}
        />
      </div>
    </EditorStateProvider>,
    { focusService: focus },
  )

  try {
    await waitFor(() => {
      expect(
        focus.resolveTarget({
          compatible: (target) => target.id.kind === 'editor' && target.id.tabId === 'settings-tab',
        }),
      ).not.toBeNull()
    })
    const ticket = focus.request({
      kind: 'match',
      matches: (target) =>
        matchesActiveSurface(target, {
          diffPath: null,
          layout: 'workbench',
          searchRoot: null,
          tabId: 'settings-tab',
        }),
    })

    await expect(ticket.completion).resolves.toMatchObject({
      status: 'acknowledged',
      targetId: { kind: 'editor', surface: 'settings', tabId: 'settings-tab' },
    })
  } finally {
    rendered.unmount()
    selectSettingsScope('user')
    selectSettingsView('form')
  }
})

test('Unicode settings preserve allowed characters and can clear them', async ({ client }) => {
  selectSettingsSearch('unicode')
  renderWithProviders(<SettingsPage />)
  const input = await screen.findByRole('textbox', { name: 'Unicode highlight allowed characters' })
  await userEvent.type(input, '–\u00a0{Enter}')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, client)
    expect(snapshot.values['editor.unicodeHighlight.allowedCharacters']).toBe('–\u00a0')
  })
  await userEvent.clear(input)
  await userEvent.type(input, '{Enter}')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, client)
    expect(snapshot.values['editor.unicodeHighlight.allowedCharacters']).toBe('')
  })
  await userEvent.click(
    screen.getByRole('switch', { name: 'Unicode highlight ambiguous characters' }),
  )
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, client)
    expect(snapshot.values['editor.unicodeHighlight.ambiguousCharacters']).toBe(false)
    expect(snapshot.values['editor.unicodeHighlight.invisibleCharacters']).toBe(true)
  })
})
