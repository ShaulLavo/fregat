import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { useState } from 'react'
import { afterEach, onTestFinished } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { entryPickerMutationKeys } from '@/components/utils/mutation-keys'
import { entryPickerQueryKeys } from '@/components/utils/query-keys'
import { clientPathFromOsPath } from '@/components/utils/picked-path'
import { usePickEntry } from '@/components/use-pick-entry'
import { toClientError } from '@/lib/client-error-taxonomy'
import type { PickedFsEntry } from '@/lib/file-system-types'
import { filePickerKeys, fileSystemKeys } from '@/lib/query-keys'
import { createObservedInProcessClient } from '../../../test/client'
import { installTestClient } from '../../../test/factories/client-binding'
import { installNativePickerHelper } from '../../../test/factories/native-picker'
import { expect, test } from '../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../test/render'

afterEach(() => {
  delete window.platformBridge
})

// The shape the desktop shell bridge rejects with when the launcher answers with an error.
function bridgeFailure(reply: { message: string; code: string; why: string; fix: string }) {
  return Object.assign(Object.create(Error.prototype) as Error, reply)
}

function NativePickerFixture({
  onPick,
  onClose,
}: {
  onPick: (entry: PickedFsEntry) => void
  onClose: () => void
}) {
  const [open, setOpen] = useState(true)
  return usePickEntry({
    open,
    value: null,
    onPick,
    onOpenChange: (next) => {
      setOpen(next)
      if (!next) onClose()
    },
  })
}

test
  .skipIf(process.platform === 'win32')
  .for(['selected', 'cancelled', 'rejected', 'not-local'] as const)(
  'native helper integration: %s (requires POSIX executable helpers)',
  async (outcome, { server, client }) => {
    delete window.platformBridge
    const chosen = path.join(server.root, 'chosen')
    await mkdir(chosen)
    let paths: readonly string[] | null = [chosen]
    if (outcome === 'rejected') paths = null
    if (outcome === 'cancelled') paths = []
    const calls = await installNativePickerHelper(server, paths)
    if (outcome === 'not-local') {
      // Exercise native locality independently of the device admission gate.
      const setting = await client.settings.write.post({
        mutationId: 'remote-picker-locality',
        target: 'user',
        operations: [{ kind: 'set', key: 'environments.devicePairing', value: false }],
      })
      expect(setting.status).toBe(200)
    }
    let posts = 0
    const transport = createObservedInProcessClient(server, (request) => {
      if (new URL(request.url).pathname !== '/fs/native-picker') return
      posts += 1
      if (outcome === 'not-local') request.headers.set('x-forwarded-for', '127.0.0.1')
    })
    onTestFinished(installTestClient(transport))
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(filePickerKeys.recents(), [])
    const selected: PickedFsEntry[] = []
    const settledAtClose: boolean[] = []
    const before = toast.getHistory().length
    renderWithProviders(
      <NativePickerFixture
        onPick={(entry) => selected.push(entry)}
        onClose={() =>
          settledAtClose.push(
            queryClient.getQueryState(filePickerKeys.recents())?.isInvalidated === true,
          )
        }
      />,
      { queryClient },
    )
    const mutation = () =>
      queryClient.getMutationCache().find({
        mutationKey: entryPickerMutationKeys.nativeSelection,
        exact: true,
      })
    if (outcome === 'selected' || outcome === 'cancelled') {
      await waitFor(() => expect(settledAtClose).toEqual([true]))
      expect(mutation()?.state.status).toBe('success')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(toast.getHistory()).toHaveLength(before)
      if (outcome === 'selected') {
        const backendPath = clientPathFromOsPath(chosen)
        expect(selected).toHaveLength(1)
        expect(selected[0]).toMatchObject({ name: 'chosen', path: backendPath, type: 'directory' })
        expect(queryClient.getQueryData(entryPickerQueryKeys.selection)).toBe(selected[0])
        expect(queryClient.getQueryData(fileSystemKeys.fileMetadata(backendPath))).toMatchObject({
          path: backendPath,
          type: 'directory',
        })
        expect((await stat(chosen)).isDirectory()).toBe(true)
      } else {
        expect(selected).toHaveLength(0)
        expect(queryClient.getQueryData(entryPickerQueryKeys.selection)).toBeNull()
      }
    } else {
      expect(await screen.findByRole('dialog')).toBeTruthy()
      await waitFor(() => expect(mutation()?.state.status).toBe('error'))
      const failure = toClientError(mutation()?.state.error)
      expect(failure).toMatchObject({
        code:
          outcome === 'not-local'
            ? 'system.NATIVE_PICKER_NOT_LOCAL'
            : 'system.NATIVE_PICKER_FAILED',
        why: expect.any(String),
        fix: expect.any(String),
      })
      await waitFor(() => expect(toast.getHistory()).toHaveLength(before + 1))
      expect(toast.getHistory().at(-1)).toMatchObject({
        title: 'Could not open folder chooser',
        action: { label: 'Fix with AI' },
        description: expect.stringContaining(failure.fix!),
      })
      expect(toast.getHistory().at(-1)).toMatchObject({
        description: expect.stringContaining(failure.why!),
      })
      expect(selected).toHaveLength(0)
      expect(settledAtClose).toHaveLength(0)
      expect(queryClient.getQueryData(entryPickerQueryKeys.selection)).toBeUndefined()
      expect(queryClient.getQueryState(entryPickerQueryKeys.capabilities)?.isInvalidated).toBe(true)
    }
    expect(queryClient.getQueryState(filePickerKeys.recents())?.isInvalidated).toBe(true)
    expect(posts).toBe(1)
    expect(await calls()).toEqual(outcome === 'not-local' ? [] : [{}])
  },
)

test.skipIf(process.platform === 'win32')(
  'a refused desktop bridge request shows the launcher error and opens the web picker',
  async ({ server, client }) => {
    void client
    await installNativePickerHelper(server, [])
    const refusal = {
      message: 'The folder chooser request is not valid.',
      code: 'desktop.webview.PICKER_REFUSED',
      why: 'The desktop app could not read the folder chooser request this window sent.',
      fix: 'Reload the window, then open the folder again.',
    }
    window.platformBridge = {
      backdrop: 'compositor',
      platform: 'linux',
      colorScheme: null,
      titlebar: 'native',
      pickEntry: () => Promise.reject(bridgeFailure(refusal)),
    }
    const queryClient = createTestQueryClient()
    const before = toast.getHistory().length
    renderWithProviders(<NativePickerFixture onPick={() => {}} onClose={() => {}} />, {
      queryClient,
    })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(toast.getHistory()).toHaveLength(before + 1))
    expect(toast.getHistory().at(-1)).toMatchObject({
      title: 'Could not open folder chooser',
      description: expect.stringContaining(refusal.fix),
    })
    expect(toast.getHistory().at(-1)).toMatchObject({
      description: expect.stringContaining(refusal.why),
    })
  },
)
