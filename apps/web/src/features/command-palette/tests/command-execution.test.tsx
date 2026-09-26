import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { act, screen, waitFor } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { CommandPalette } from '@/components/command-palette'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import type {
  SettingsIntentSettlement,
  SettingsSubmission,
} from '@workspace/client-core/settings/intent-store'
import { writeRootFolderCache } from '@/features/workspace/state/cache'
import { useCommand } from '@/keymap/hooks/use-command'
import { TestCommandProvider } from '../../../../test/factories/command-runtime'
import { expect, test } from '../../../../test/fixtures'
import { renderWithLoadedDialogs } from '../../../../test/render'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import { focusTargetById } from '@/lib/focus/state/service'

test.beforeEach(() => {
  writeRootFolderCache(testScopedStorage, null)
})

test.afterEach(() => {
  writeRootFolderCache(testScopedStorage, null)
})

test('waits for async command settlement before closing and restoring its origin', async () => {
  const submission = deferredSettingsSubmission()
  const setWallpaperEnabled = vi.fn(() => submission.value)
  await renderPalette({ setWallpaperEnabled })
  const user = userEvent.setup()
  const origin = screen.getByRole('button', { name: 'Open palette from editor' })

  await user.click(origin)
  const input = await focusedPaletteInput()
  await user.type(input, 'toggle wallpaper')
  await user.click(await screen.findByText('Toggle wallpaper'))

  await waitFor(() => expect(setWallpaperEnabled).toHaveBeenCalledOnce())
  expect(screen.getByPlaceholderText('Search commands…')).toBe(input)
  expect(document.activeElement).not.toBe(origin)

  act(() => submission.settle('acknowledged'))

  await waitFor(() => expect(screen.queryByPlaceholderText('Search commands…')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(origin))
})

test('does not overwrite a command destination that acknowledged another overlay', async () => {
  await renderPalette({ settingsDestination: true })
  const user = userEvent.setup()
  const origin = screen.getByRole('button', { name: 'Open palette from editor' })
  const settings = screen.getByRole('button', { name: 'Settings overlay' })

  await user.click(origin)
  const input = await focusedPaletteInput()
  await user.type(input, 'settings')
  await user.click(await screen.findByText('Settings'))

  await waitFor(() => expect(screen.queryByPlaceholderText('Search commands…')).toBeNull())
  expect(document.activeElement).toBe(settings)
})

test('restores a captured nested overlay after dismissal', async () => {
  await renderPalette()
  const user = userEvent.setup()
  const settings = screen.getByRole('button', { name: 'Settings overlay' })

  await user.click(settings)
  await focusedPaletteInput()
  await user.keyboard('{Escape}')

  await waitFor(() => expect(screen.queryByPlaceholderText('Search commands…')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(settings))
})

function renderPalette({
  setWallpaperEnabled,
  settingsDestination = false,
}: {
  readonly setWallpaperEnabled?: () => SettingsSubmission
  readonly settingsDestination?: boolean
} = {}) {
  return renderWithLoadedDialogs(
    <EditorStateProvider>
      <PaletteRuntime
        setWallpaperEnabled={setWallpaperEnabled}
        settingsDestination={settingsDestination}
      />
    </EditorStateProvider>,
    { application: createTestApplicationRuntime(), command: false },
  )
}

function PaletteRuntime({
  setWallpaperEnabled,
  settingsDestination,
}: {
  readonly setWallpaperEnabled?: () => SettingsSubmission
  readonly settingsDestination: boolean
}) {
  const focus = useFocusService()
  const queryClient = useQueryClient()
  const showSettings = settingsDestination
    ? () => focus.request(focusTargetById({ kind: 'settings-dialog' }))
    : undefined

  return (
    <TestCommandProvider
      options={{
        runtime: {
          settings: setWallpaperEnabled ? { setWallpaperEnabled } : undefined,
          shell: showSettings ? { showSettings } : undefined,
        },
      }}
      queryClient={queryClient}
    >
      <PaletteTargets />
      <CommandPalette />
    </TestCommandProvider>
  )
}

function PaletteTargets() {
  const { bus } = useCommand()
  const { ref: editorRef } = useFocusTarget<HTMLButtonElement>({
    area: 'editor',
    capabilities: { editor: { dispatch: () => false, writable: true } },
    id: { key: '/repo/src/origin.ts', kind: 'editor', surface: 'document' },
    onIntent: focusButton,
  })
  const { ref: settingsRef } = useFocusTarget<HTMLButtonElement>({
    area: 'settings',
    capabilities: { overlay: true },
    id: { kind: 'settings-dialog' },
    onIntent: focusButton,
  })

  function openPalette() {
    bus.dispatch('workspace.showCommandPalette', {
      source: { caller: 'command-execution-test', kind: 'programmatic' },
    })
  }

  return (
    <div data-workbench>
      <button onClick={openPalette} ref={editorRef} type='button'>
        Open palette from editor
      </button>
      <button onClick={openPalette} ref={settingsRef} type='button'>
        Settings overlay
      </button>
    </div>
  )
}

function focusButton(intent: string, element: HTMLElement) {
  if (intent !== 'focus') return false

  element.focus()
  return true
}

async function focusedPaletteInput() {
  const input = await screen.findByPlaceholderText('Search commands…')
  await waitFor(() => expect(document.activeElement).toBe(input))
  return input
}

function deferredSettingsSubmission() {
  let resolve!: (settlement: SettingsIntentSettlement) => void
  const settled = new Promise<SettingsIntentSettlement>((settle) => {
    resolve = settle
  })

  return {
    settle: resolve,
    value: { kind: 'submitted', mutationId: 'palette-settings', settled } as const,
  }
}
