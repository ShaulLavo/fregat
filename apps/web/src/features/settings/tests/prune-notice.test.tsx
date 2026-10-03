import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { act, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { Toaster } from '@workspace/ui/components/sonner'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { DiagnosticsBanner } from '@/features/settings/components/diagnostics-banner'
import { fetchSettings } from '@/features/settings/utils/api'
import { notifyPrunedSettings } from '@/features/settings/utils/notify-pruned-settings'
import { admitSettingsEvent } from '@/features/settings/state/snapshot-admission'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'

// A GET delivery can notify before the application toaster mounts.
test('shows one transient info notice with every pruned setting detail and ignores cache replays', async ({
  server,
  client,
}) => {
  const userFile = path.join(server.root, '.platform-test', 'settings.json')
  await mkdir(path.dirname(userFile), { recursive: true })
  await writeFile(userFile, '{ "window.frost": true, "retired.example": true }')
  await server.restart()
  const previous = toast.getHistory().length
  const snapshot = await fetchSettings(undefined, client)
  const details = snapshot.diagnostics
    .filter((diagnostic) => diagnostic.kind === 'removed-key')
    .map((diagnostic) => diagnostic.detail)
  expect(details).toHaveLength(2)
  const message = details.join(' ')
  const owner = createTestQueryClient()
  owner.setQueryData(settingsKeys.document(), snapshot)
  const content = (
    <>
      <Toaster />
      <DiagnosticsBanner diagnostics={snapshot.diagnostics} />
      <span>Settings ready</span>
    </>
  )
  let view = renderWithProviders(content, { queryClient: owner, settingsOwner: owner })

  try {
    expect(await screen.findByText(message)).toBeDefined()
    const notices = () => toast.getHistory().slice(previous)
    expect(notices()).toHaveLength(1)
    expect(notices()[0]).toMatchObject({ type: 'info', title: message })
    expect(notices()[0]).not.toHaveProperty('duration', Number.POSITIVE_INFINITY)
    expect(screen.queryByText(/not applied/)).toBeNull()
    expect(screen.queryByText('window.frost')).toBeNull()

    const clean = await fetchSettings(undefined, client)
    expect(clean.diagnostics.some((diagnostic) => diagnostic.kind === 'removed-key')).toBe(false)
    await act(async () => {
      owner.setQueryData(settingsKeys.document(), clean)
    })
    // A changed cache object with the same server version is still the same event.
    await act(async () => {
      owner.setQueryData(settingsKeys.document(), structuredClone(snapshot))
    })
    expect(notices()).toHaveLength(1)

    act(() => {
      toast.dismiss(notices()[0]!.id)
    })
    await waitFor(() => expect(screen.queryByText(message)).toBeNull())
    view.unmount()
    view = renderWithProviders(content, { queryClient: owner, settingsOwner: owner })
    await screen.findByText('Settings ready')
    expect(notices()).toHaveLength(1)
    expect(screen.queryByText(message)).toBeNull()

    await act(async () => {
      notifyPrunedSettings({
        ...snapshot,
        serverVersion: { ...snapshot.serverVersion, sequence: snapshot.serverVersion.sequence + 1 },
      })
    })
    await waitFor(() => expect(notices()).toHaveLength(2))
    await act(async () => {
      notifyPrunedSettings({
        ...snapshot,
        serverVersion: { ...snapshot.serverVersion, epoch: `${snapshot.serverVersion.epoch}-next` },
      })
    })
    await waitFor(() => expect(notices()).toHaveLength(3))
  } finally {
    view.unmount()
    toast.dismiss()
  }
})

test('notifies once for equal and stale event deliveries rejected by snapshot admission', async ({
  client,
}) => {
  const clean = await fetchSettings(undefined, client)
  const owner = createTestQueryClient()
  owner.setQueryData(settingsKeys.document(), clean)
  const snapshot = {
    ...clean,
    diagnostics: [
      {
        id: 'window.frost',
        kind: 'removed-key' as const,
        layer: 'user' as const,
        detail: 'Window frost was replaced by Window material.',
      },
    ],
  }
  const previous = toast.getHistory().length
  const notices = () => toast.getHistory().slice(previous)
  try {
    const equal = await admitSettingsEvent(owner, { changedSettingIds: [], snapshot })
    expect(equal.admitted).toBe(false)
    expect(owner.getQueryData(settingsKeys.document())).toBe(clean)
    expect(notices()).toHaveLength(1)
    await admitSettingsEvent(owner, { changedSettingIds: [], snapshot })
    expect(notices()).toHaveLength(1)

    owner.setQueryData(settingsKeys.document(), {
      ...clean,
      serverVersion: { ...clean.serverVersion, sequence: clean.serverVersion.sequence + 2 },
    })
    const stale = await admitSettingsEvent(owner, {
      changedSettingIds: [],
      snapshot: {
        ...snapshot,
        serverVersion: { ...snapshot.serverVersion, sequence: snapshot.serverVersion.sequence + 1 },
      },
    })
    expect(stale.admitted).toBe(false)
    expect(notices()).toHaveLength(2)
    expect(notices()[1]).toMatchObject({ type: 'info', title: snapshot.diagnostics[0]!.detail })
  } finally {
    toast.dismiss()
  }
})
