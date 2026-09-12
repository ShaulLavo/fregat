import { act, waitFor } from '@testing-library/react'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { useRef } from 'react'

import { useFilePickerPathInput } from '@/features/file-picker/hooks/use-path-input'
import { useFilePickerSession } from '@/features/file-picker/state'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { fetchServerInfo } from '@/lib/file-server'
import { createInProcessClient, createObservedInProcessClient } from '../../../../test/client'
import { installTestClient } from '../../../../test/factories/client-binding'
import { createRequestGate } from '../../../../test/factories/request-gate'
import { expect, test } from '../../../../test/fixtures'
import { renderHookWithProviders } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'

test('a pending path keeps its validation owner and original navigation session across a render', async ({
  server,
}) => {
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const gate = createRequestGate((request) => new URL(request.url).pathname === '/fs/stat')
  const clientA = createObservedInProcessClient(server, gate.beforeRequest)
  const clientB = createInProcessClient(secondServer)
  const restore = installTestClient(clientA)
  const origin = activeServerOrigin()
  await mkdir(path.join(server.root, 'folder'))
  await writeFile(path.join(secondServer.root, 'folder'), 'This owner has a file, not a directory.')
  const serverInfo = await fetchServerInfo(new AbortController().signal, clientA)
  const { result, rerender, queryClient, unmount } = renderHookWithProviders(
    ({ owner }: { owner: 'a' | 'b' }) => {
      const first = useFilePickerSession(null)
      const second = useFilePickerSession(null)
      const sequence = useRef(0)
      const input = useFilePickerPathInput({
        currentPath: '',
        onIntentStart: () => ++sequence.current,
        onNavigate: owner === 'a' ? first.navigateTo : second.navigateTo,
        serverInfo,
      })
      return { first, second, input }
    },
    { initialProps: { owner: 'a' } },
  )
  act(() => result.current.input.open())
  act(() => result.current.input.change(path.join(serverInfo.workspaceRoot, 'folder')))
  let pending: Promise<void> | undefined
  act(() => {
    pending = result.current.input.submit()
  })
  await gate.entered
  setActiveServerOrigin('http://localhost:3498')
  const previousB = getClient()
  setClient(clientB)

  try {
    rerender({ owner: 'b' })
    await act(async () => {
      gate.release()
      await pending
    })
    expect(result.current.first.currentPath).toBe('folder')
    expect(result.current.first.backPath).toBe('')
    expect(result.current.second.currentPath).toBe('')
    expect(result.current.input.error).toBeNull()
    expect((await clientB.fs.stat.get({ query: { path: 'folder' } })).data?.type).toBe('file')
  } finally {
    gate.release()
    unmount()
    queryClient.clear()
    setClient(previousB)
    setActiveServerOrigin(origin)
    restore()
    await secondServer.cleanup()
  }
})

test('an older validation cannot navigate or clear the input after a newer submission', async ({
  server,
}) => {
  const gate = createRequestGate(
    (request) => new URL(request.url).searchParams.get('path') === 'first',
  )
  const client = createObservedInProcessClient(server, gate.beforeRequest)
  const restore = installTestClient(client)
  await mkdir(path.join(server.root, 'first'))
  await mkdir(path.join(server.root, 'second'))
  const serverInfo = await fetchServerInfo(new AbortController().signal, client)
  const { result, queryClient, unmount } = renderHookWithProviders(() => {
    const session = useFilePickerSession(null)
    const sequence = useRef(0)
    const input = useFilePickerPathInput({
      currentPath: '',
      onIntentStart: () => ++sequence.current,
      onNavigate: session.navigateTo,
      serverInfo,
    })
    return { input, session }
  })

  try {
    act(() => result.current.input.open())
    act(() => result.current.input.change(path.join(serverInfo.workspaceRoot, 'first')))
    let first: Promise<void> | undefined
    act(() => {
      first = result.current.input.submit()
    })
    await gate.entered
    act(() => result.current.input.change(path.join(serverInfo.workspaceRoot, 'second')))
    await act(() => result.current.input.submit())
    await waitFor(() => expect(result.current.session.currentPath).toBe('second'))
    act(() => result.current.input.open())
    act(() => result.current.input.change('newer draft'))
    await act(async () => {
      gate.release()
      await first
    })
    expect(result.current.session.currentPath).toBe('second')
    expect(result.current.input).toMatchObject({
      draft: 'newer draft',
      isEditing: true,
      isPending: false,
      error: null,
    })
  } finally {
    gate.release()
    unmount()
    queryClient.clear()
    restore()
  }
})
