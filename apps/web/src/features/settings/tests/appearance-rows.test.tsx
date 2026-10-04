import { settingRowIds } from '@workspace/contracts/settings/presentation'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  BUNDLED_THEMES,
  DEFAULT_SETTING_VALUES,
  settingsMutationRequestSchema,
  type SettingsMutationRequest,
  type SettingsOperation,
  type SettingsSnapshot,
} from '@workspace/contracts'

import { activeServerOrigin, getClient } from '@/lib/client'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { expect, test } from '../../../../test/fixtures'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { SETTINGS_MUTATION_KEY } from '@/features/settings/utils/mutation-keys'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { SettingsPage } from '../components/page'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { Button } from '@workspace/ui/components/button'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'valibot'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { createObservedInProcessClient } from '../../../../test/client'
import { createRequestGate } from '../../../../test/factories/request-gate'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'

// The whole settings page renders here; a shared CI runner takes about 6x a workstation.
const SLOW_RENDER_TIMEOUT_MS = 60_000
const THEME = BUNDLED_THEMES[0]!
const KEY = 'workbench.surface.contentOpacity'

test.beforeEach(() => {
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsSearch('content')
  selectSettingsCategory(null)
})

async function seed(operations: readonly SettingsOperation[]) {
  await saveSettings(
    { mutationId: crypto.randomUUID(), operations: [...operations], target: 'user' },
    getClient(),
  )
}

function contentSlider() {
  return screen.findByRole('slider', { name: 'Content opacity' })
}

async function userLayer() {
  const snapshot = await fetchSettings(undefined, getClient())
  return {
    raw: snapshot.layers.find((layer) => layer.id === 'user')?.raw ?? {},
    halves: snapshot.values['workbench.theme.customizations'][THEME.id],
  }
}

// The page reads mode changes from its own writes; the test has no settings stream.
function LightModeButton() {
  const { setColorTheme } = useSettingsActions()
  return (
    <Button size='sm' onClick={() => setColorTheme('light', 'dark')}>
      Light
    </Button>
  )
}

test(
  'with a theme selected, a part row shows the theme value for the mode on screen and says which',
  async ({ client }) => {
    expect(client).toBeDefined()
    await seed([
      { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
      { kind: 'set', key: 'workbench.theme', value: THEME },
      {
        kind: 'theme.customize',
        id: THEME.id,
        mode: 'dark',
        patch: { material: { contentOpacity: 20 } },
      },
    ])
    renderWithProviders(
      <>
        <SettingsPage />
        <LightModeButton />
      </>,
    )

    expect(await contentSlider()).toHaveAttribute('aria-valuenow', '20')
    expect(await screen.findByText(/Dark mode\.$/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    await screen.findByText(/Light mode\.$/)
    expect(await contentSlider()).toHaveAttribute(
      'aria-valuenow',
      String(THEME.variants.light.material.contentOpacity),
    )
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'editing a part under a theme writes one theme.customize for the shown mode, and Reset returns the theme value',
  async ({ client }) => {
    expect(client).toBeDefined()
    await seed([
      { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
      { kind: 'set', key: 'workbench.theme', value: THEME },
    ])
    const { queryClient } = renderWithProviders(<SettingsPage />)
    const settingsWrites = () =>
      queryClient.getMutationCache().findAll({ mutationKey: SETTINGS_MUTATION_KEY, exact: true })
    const before = settingsWrites().length
    const themed = THEME.variants.dark.material.contentOpacity

    const slider = await contentSlider()
    slider.focus()
    await userEvent.keyboard('{ArrowRight}')

    await waitFor(async () => {
      const { halves, raw } = await userLayer()
      expect(halves?.dark?.material?.contentOpacity).toBe(themed + 1)
      expect(halves?.light).toBeUndefined()
      expect(raw).not.toHaveProperty(KEY)
    })
    expect(settingsWrites()).toHaveLength(before + 1)

    await userEvent.click(await screen.findByRole('button', { name: `Actions for ${KEY}` }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset to default' }))
    await waitFor(async () => expect((await userLayer()).halves).toBeUndefined())
    await waitFor(async () =>
      expect(await contentSlider()).toHaveAttribute('aria-valuenow', String(themed)),
    )
  },
  SLOW_RENDER_TIMEOUT_MS,
)

// A theme update: the same theme id with a new revision, as the bundle library writes it.
function UpdateThemeButton({ contentOpacity }: { readonly contentOpacity: number }) {
  const { selectBundle } = useSettingsActions()
  const dark = THEME.variants.dark
  const updated = {
    ...THEME,
    revision: `${THEME.revision}-next`,
    variants: {
      ...THEME.variants,
      dark: { ...dark, material: { ...dark.material, contentOpacity } },
    },
  }
  return (
    <Button size='sm' onClick={() => selectBundle(updated)}>
      Update theme
    </Button>
  )
}

async function resetFromMenu(key: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Actions for ${key}` }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset to default' }))
}

test(
  'Reset removes the part override, so a later change to the theme reaches the row',
  async ({ client }) => {
    expect(client).toBeDefined()
    await seed([
      { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
      { kind: 'set', key: 'workbench.theme', value: THEME },
      {
        kind: 'theme.customize',
        id: THEME.id,
        mode: 'dark',
        patch: { material: { contentOpacity: 20 } },
      },
    ])
    const next = (THEME.variants.dark.material.contentOpacity + 37) % 100
    renderWithProviders(
      <>
        <SettingsPage />
        <UpdateThemeButton contentOpacity={next} />
      </>,
    )
    expect(await contentSlider()).toHaveAttribute('aria-valuenow', '20')

    await resetFromMenu(KEY)
    await waitFor(() => expect(modifiedMarker(KEY)).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Update theme' }))

    await waitFor(async () =>
      expect(await contentSlider()).toHaveAttribute('aria-valuenow', String(next)),
    )
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'moving a part away and back to the theme value removes the override, so theme updates reach it',
  async ({ client }) => {
    expect(client).toBeDefined()
    await seed([
      { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
      { kind: 'set', key: 'workbench.theme', value: THEME },
    ])
    const themed = THEME.variants.dark.material.contentOpacity
    const next = (themed + 37) % 100
    renderWithProviders(
      <>
        <SettingsPage />
        <UpdateThemeButton contentOpacity={next} />
      </>,
    )

    const slider = await contentSlider()
    slider.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(async () =>
      expect((await userLayer()).halves?.dark?.material?.contentOpacity).toBe(themed + 1),
    )
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(async () => expect((await userLayer()).halves).toBeUndefined())
    await waitFor(() => expect(modifiedMarker(KEY)).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'Update theme' }))
    await waitFor(async () =>
      expect(await contentSlider()).toHaveAttribute('aria-valuenow', String(next)),
    )
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'Reset in dark mode removes the dark override and keeps the light one',
  async ({ client }) => {
    expect(client).toBeDefined()
    await seed([
      { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
      { kind: 'set', key: 'workbench.theme', value: THEME },
      {
        kind: 'theme.customize',
        id: THEME.id,
        mode: 'dark',
        patch: { material: { contentOpacity: 20 } },
      },
      {
        kind: 'theme.customize',
        id: THEME.id,
        mode: 'light',
        patch: { material: { contentOpacity: 30 } },
      },
    ])
    renderWithProviders(<SettingsPage />)
    expect(await contentSlider()).toHaveAttribute('aria-valuenow', '20')

    await resetFromMenu(KEY)

    await waitFor(async () =>
      expect((await userLayer()).halves).toEqual({ light: { material: { contentOpacity: 30 } } }),
    )
  },
  SLOW_RENDER_TIMEOUT_MS,
)

function ResetTwoPartsButton({
  onReset,
}: {
  readonly onReset: (submissions: readonly SettingsSubmission[]) => void
}) {
  const { resetSetting } = useSettingsActions()
  const resetBoth = () => {
    onReset([
      resetSetting(KEY, settingRowIds(KEY)),
      resetSetting('workbench.surface.blur', settingRowIds('workbench.surface.blur')),
    ])
  }
  return (
    <Button size='sm' onClick={resetBoth}>
      Reset two
    </Button>
  )
}

test(
  'two resets of different parts sent together both apply',
  async ({ client, server }) => {
    expect(client).toBeDefined()
    await seed([
      { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
      { kind: 'set', key: 'workbench.theme', value: THEME },
      {
        kind: 'theme.customize',
        id: THEME.id,
        mode: 'dark',
        patch: { palette: 'sage', material: { contentOpacity: 20, blur: 3 } },
      },
      {
        kind: 'theme.customize',
        id: THEME.id,
        mode: 'light',
        patch: { material: { contentOpacity: 30, blur: 5 } },
      },
    ])
    const requests: SettingsMutationRequest[] = []
    const secondReset = createRequestGate(() => requests.length === 2)
    const observed = createObservedInProcessClient(server, async (request) => {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/settings/write') return
      requests.push(parse(settingsMutationRequestSchema, await request.clone().json()))
      return secondReset.beforeRequest(request)
    })
    const queryClient = createTestQueryClient()
    registerEnvironmentQueryClient(queryClient, activeServerOrigin(), observed)
    const submissions = Promise.withResolvers<readonly SettingsSubmission[]>()
    renderWithProviders(
      <>
        <SettingsPage />
        <ResetTwoPartsButton onReset={submissions.resolve} />
      </>,
      { queryClient },
    )
    expect(await contentSlider()).toHaveAttribute('aria-valuenow', '20')
    expect(
      queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document())?.values['workbench.theme']
        ?.id,
    ).toBe(THEME.id)

    await userEvent.click(screen.getByRole('button', { name: 'Reset two' }))
    const resets = await submissions.promise
    const settled = Promise.all(
      resets.map((reset) => (reset.kind === 'submitted' ? reset.settled : 'noop')),
    )
    try {
      expect(resets.map((reset) => reset.kind)).toEqual(['submitted', 'submitted'])
      await secondReset.entered
      const writes = queryClient.getMutationCache().findAll({
        mutationKey: SETTINGS_MUTATION_KEY,
        exact: true,
      })
      expect(writes.map((write) => write.state.status)).toEqual(['success', 'pending'])
      expect(requests.map((request) => request.target)).toEqual(['user', 'user'])
      expect(requests.map((request) => request.operations)).toEqual([
        [
          {
            kind: 'theme.uncustomize',
            id: THEME.id,
            mode: 'dark',
            part: 'material.contentOpacity',
          },
        ],
        [{ kind: 'theme.uncustomize', id: THEME.id, mode: 'dark', part: 'material.blur' }],
      ])
      expect((await userLayer()).halves).toEqual({
        dark: { palette: 'sage', material: { blur: 3 } },
        light: { material: { contentOpacity: 30, blur: 5 } },
      })
      selectSettingsScope('workspace')
    } finally {
      await act(async () => {
        secondReset.release()
        await expect(settled).resolves.toEqual(['acknowledged', 'acknowledged'])
      })
    }

    const expected = {
      dark: { palette: 'sage' },
      light: { material: { contentOpacity: 30, blur: 5 } },
    }
    expect((await userLayer()).halves).toEqual(expected)
    expect(
      queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document())?.values[
        'workbench.theme.customizations'
      ][THEME.id],
    ).toEqual(expected)
    expect(
      JSON.parse(await readFile(path.join(server.root, '.platform-test', 'settings.json'), 'utf8')),
    ).toHaveProperty(['workbench.theme.customizations', THEME.id], expected)
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'a part set to the theme value still counts as modified, and Reset removes it',
  async ({ client }) => {
    expect(client).toBeDefined()
    const themed = THEME.variants.dark.material.contentOpacity
    await seed([
      { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
      { kind: 'set', key: 'workbench.theme', value: THEME },
      {
        kind: 'theme.customize',
        id: THEME.id,
        mode: 'dark',
        patch: { material: { contentOpacity: themed } },
      },
    ])
    renderWithProviders(<SettingsPage />)
    expect(await contentSlider()).toHaveAttribute('aria-valuenow', String(themed))
    await waitFor(() => expect(modifiedMarker(KEY)).not.toBeNull())

    await resetFromMenu(KEY)

    await waitFor(async () => expect((await userLayer()).halves).toBeUndefined())
    await waitFor(() => expect(modifiedMarker(KEY)).toBeNull())
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'with no theme, a part row writes its own key and names no mode',
  async ({ client }) => {
    expect(client).toBeDefined()
    await seed([{ kind: 'set', key: 'workbench.colorTheme', value: 'dark' }])
    renderWithProviders(<SettingsPage />)

    const slider = await contentSlider()
    expect(screen.queryByText(/Dark mode\.$/)).toBeNull()
    slider.focus()
    await userEvent.keyboard('{ArrowLeft}')

    await waitFor(async () => {
      const { raw } = await userLayer()
      expect(raw[KEY]).toBe(DEFAULT_SETTING_VALUES[KEY] - 1)
    })
  },
  SLOW_RENDER_TIMEOUT_MS,
)

function PickThemeButton() {
  const { selectBundle } = useSettingsActions()
  return (
    <Button size='sm' onClick={() => selectBundle(THEME)}>
      Pick theme
    </Button>
  )
}

function modifiedMarker(key: string) {
  return document.querySelector(`[data-setting-row="${key}"] [aria-label="Modified"]`)
}

test(
  'Reset under a theme also clears a value written before the theme was picked',
  async ({ client }) => {
    expect(client).toBeDefined()
    await seed([{ kind: 'set', key: 'workbench.colorTheme', value: 'dark' }])
    renderWithProviders(
      <>
        <SettingsPage />
        <PickThemeButton />
      </>,
    )

    ;(await contentSlider()).focus()
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(async () => expect((await userLayer()).raw).toHaveProperty(KEY))
    await userEvent.click(screen.getByRole('button', { name: 'Pick theme' }))
    await screen.findByText(/Dark mode\.$/)
    expect(modifiedMarker(KEY)).not.toBeNull()

    await userEvent.click(await screen.findByRole('button', { name: `Actions for ${KEY}` }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset to default' }))

    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, getClient())
      expect(snapshot.layers.find((layer) => layer.id === 'user')?.raw).not.toHaveProperty(KEY)
      expect(snapshot.diagnostics.filter((entry) => entry.id === KEY)).toEqual([])
    })
    await waitFor(() => expect(modifiedMarker(KEY)).toBeNull())
  },
  SLOW_RENDER_TIMEOUT_MS,
)

test(
  'a settings list moves its cursor freely and writes only on Enter, never on focus',
  async ({ client }) => {
    expect(client).toBeDefined()
    // A value the list does not offer, so focus has no row to land on.
    await seed([{ kind: 'set', key: 'editor.codeTheme.dark', value: 'no-such-theme' }])
    selectSettingsSearch('code theme in dark')
    const { queryClient } = renderWithProviders(<SettingsPage />)
    const writes = () =>
      queryClient.getMutationCache().findAll({ mutationKey: SETTINGS_MUTATION_KEY, exact: true })
        .length

    const list = await screen.findByRole('listbox', { name: 'Code theme in dark mode' })
    list.focus()
    const start = list.getAttribute('aria-activedescendant')
    expect(writes()).toBe(0)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}d')
    expect(writes()).toBe(0)

    const cursor = list.getAttribute('aria-activedescendant')
    expect(cursor).not.toBe(start)
    await userEvent.keyboard('{Enter}')
    expect(writes()).toBe(1)
    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, getClient())
      expect(snapshot.values['editor.codeTheme.dark']).not.toBe('no-such-theme')
      expect(cursor).toContain(snapshot.values['editor.codeTheme.dark'])
    })
  },
  SLOW_RENDER_TIMEOUT_MS,
)
