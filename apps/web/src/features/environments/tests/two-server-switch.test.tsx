import { filesystemPath } from '@/lib/documents/utils/identity'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { createEditorBufferSession } from '@singapore-editor/core'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { activeServerOrigin, setActiveServerOrigin, setClient } from '@/lib/client'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createApplicationRuntime } from '@/state/application-runtime'
import { fetchFile } from '@/lib/file-server'
import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { renderApplication } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'

const originA = 'http://localhost:37111'
const originB = 'http://localhost:37112'
const key = ['environment-switch-proof']

test('the real provider stack moves observers and mutation invalidations between two servers', async ({
  client,
  server,
}) => {
  const previousOrigin = activeServerOrigin()
  const previousState = useEnvironmentsStore.getState()
  const second = await makeTestServer({ filesystemWatch: false })
  setActiveServerOrigin(originA)
  setClient(client)
  setActiveServerOrigin(originB)
  const clientB = createInProcessClient(second)
  setClient(clientB)
  useEnvironmentsStore.getState().activate(originA)
  const identityA = v.parse(healthDescriptorSchema, (await client.health.get()).data).environmentId
  const identityB = v.parse(healthDescriptorSchema, (await clientB.health.get()).data).environmentId
  await readEnvironmentDescriptor(originA, new AbortController().signal)
  await readEnvironmentDescriptor(originB, new AbortController().signal)
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(environmentScopedStorage(confirmedEnvironmentId(originA))),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark-plus',
      syntaxHighlightingEnabled: false,
    },
  })
  const view = renderApplication(<HealthView />, application)

  try {
    await waitFor(() => expect(screen.getByTestId('identity').textContent).toBe(identityA))
    const editorA = application.getSnapshot().editor
    act(() => application.activateEnvironment(`${originA}/`))
    expect(application.getSnapshot().editor).toBe(editorA)
    expect(queryClientFor(`${originA}/`)).toBe(queryClientFor(originA))
    await writeFile(join(server.root, 'draft.txt'), 'saved')
    const file = await fetchFile(filesystemPath('draft.txt'), new AbortController().signal, client)
    const documentA = editorA.documentStore.getState().ensureLiveEditorDocument(file)
    createEditorBufferSession(documentA.buffer).applyText(' unsaved')
    const cacheA = queryClientFor(originA)
    expect(cacheA.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(1)

    act(() => application.activateEnvironment(originB))
    await waitFor(() => expect(screen.getByTestId('identity').textContent).toBe(identityB))
    const cacheB = queryClientFor(originB)
    expect(cacheA.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(0)
    expect(cacheB.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(1)
    expect(application.getSnapshot().editor).not.toBe(editorA)
    expect(application.getSnapshot().editor.hasUnsavedDocuments()).toBe(false)
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh through mutation' }))
    await waitFor(() => expect(screen.getByTestId('mutation').textContent).toBe(identityB))
    await act(() => cacheA.invalidateQueries({ queryKey: key, refetchType: 'all' }))
    expect(screen.getByTestId('identity').textContent).toBe(identityB)
    expect(cacheA.getQueryData(key)).toBe(identityA)
    expect(cacheB.getQueryData(key)).toBe(identityB)

    act(() => application.activateEnvironment(originA))
    await waitFor(() => expect(screen.getByTestId('identity').textContent).toBe(identityA))
    expect(application.getSnapshot().editor).toBe(editorA)
    expect(documentA.buffer.materializeFullText()).toBe('saved unsaved')
    expect(cacheB.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(0)
  } finally {
    view.unmount()
    application.dispose()
    queryClientFor(originA).clear()
    queryClientFor(originB).clear()
    useEnvironmentsStore.setState(previousState, true)
    setActiveServerOrigin(previousOrigin)
    await second.cleanup()
  }
})

function HealthView() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ client, signal }) =>
      v.parse(
        healthDescriptorSchema,
        (await clientForQueryClient(client).health.get({ fetch: { signal } })).data,
      ).environmentId,
  })
  const mutation = useMutation({
    mutationFn: async () =>
      v.parse(healthDescriptorSchema, (await clientForQueryClient(queryClient).health.get()).data)
        .environmentId,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })
  return (
    <>
      <output data-testid='identity'>{query.data}</output>
      <output data-testid='mutation'>{mutation.data}</output>
      <button onClick={() => mutation.mutate()}>Refresh through mutation</button>
    </>
  )
}
