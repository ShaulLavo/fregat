import { afterEach, onTestFinished } from 'vitest'
import { toast } from 'sonner'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { act, screen, waitFor } from '@testing-library/react'
import { entryPickerQueryKeys } from '@/components/utils/query-keys'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { createObservedInProcessClient } from '../../../test/client'
import { installTestClient } from '../../../test/factories/client-binding'
import { recordClientLog } from '../../../test/factories/client-log'
import { serverCapabilities } from '../../../test/factories/server-capabilities'
import { createClientInvariantError } from '@/lib/structured-errors'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'
import { usePickEntry } from '../use-pick-entry'

afterEach(() => {
  delete window.platformBridge
})

function PickerFixture({ open = true }: { open?: boolean }) {
  return usePickEntry({ open, value: null, onOpenChange: () => {}, onPick: () => {} })
}

test('closed picker defers its runtime and capabilities until it opens', async ({
  server,
  client,
}) => {
  const identity = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  let calls = 0
  server.app
    .get('/system/capabilities', () => {
      calls += 1
      return serverCapabilities(identity.environmentId)
    })
    .compile()
  resourceQueryClient.removeQueries({ queryKey: entryPickerQueryKeys.module, exact: true })
  const view = renderWithProviders(<PickerFixture open={false} />)
  expect(resourceQueryClient.getQueryState(entryPickerQueryKeys.module)).toMatchObject({
    status: 'pending',
    fetchStatus: 'idle',
  })
  expect(view.queryClient.getQueryState(entryPickerQueryKeys.capabilities)).toBeUndefined()
  expect(calls).toBe(0)
  expect(screen.queryByRole('dialog')).toBeNull()

  view.rerender(<PickerFixture />)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(resourceQueryClient.getQueryState(entryPickerQueryKeys.module)?.status).toBe('success')
  expect(calls).toBe(1)
  expect(view.queryClient.getQueryData(entryPickerQueryKeys.capabilities)).toMatchObject({
    nativePicker: false,
  })
})

test('Chromium bridge without native picker opens the web folder picker', async ({ client }) => {
  void client
  window.platformBridge = {
    backdrop: 'compositor',
    platform: 'linux',
    colorScheme: null,
    titlebar: 'native',
  }
  renderWithProviders(<PickerFixture />)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(await screen.findByRole('heading', { name: 'Open folder' })).toBeTruthy()
})

test('unverified locality uses the server-filesystem picker even with a native host', async ({
  client,
}) => {
  void client
  let calls = 0
  window.platformBridge = {
    backdrop: 'compositor',
    platform: 'linux',
    colorScheme: null,
    titlebar: 'native',
    pickEntry: async () => {
      calls += 1
      throw createClientInvariantError('The native chooser fixture failed.')
    },
  }
  renderWithProviders(<PickerFixture />)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(calls).toBe(0)
})

test.for([404, 501])(
  'capabilities endpoint status %s uses a silent fallback',
  async (status, { server, client }) => {
    void client
    server.app.get('/system/capabilities', () =>
      Response.json({ message: 'Unsupported endpoint' }, { status }),
    )
    const before = toast.getHistory().length
    const logs = recordClientLog('warn')
    const view = renderWithProviders(<PickerFixture />)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() =>
      expect(view.queryClient.getQueryState(entryPickerQueryKeys.capabilities)?.status).toBe(
        'success',
      ),
    )
    expect(toast.getHistory()).toHaveLength(before)
    expect(logs.events('platform.picker_capabilities.summary')).toHaveLength(0)
  },
)

test('a valid nativePicker false capability uses a silent fallback', async ({ server, client }) => {
  const identity = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  server.app.get('/system/capabilities', () => serverCapabilities(identity.environmentId)).compile()
  const before = toast.getHistory().length
  const logs = recordClientLog('warn')
  const view = renderWithProviders(<PickerFixture />)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  await waitFor(() =>
    expect(view.queryClient.getQueryData(entryPickerQueryKeys.capabilities)).toMatchObject({
      nativePicker: false,
    }),
  )
  expect(toast.getHistory()).toHaveLength(before)
  expect(logs.events('platform.picker_capabilities.summary')).toHaveLength(0)
})

test.for(['network', 'server', 'schema'] as const)(
  'capabilities %s failure reports structured guidance once across picker opens',
  async (kind, { server, client }) => {
    void client
    if (kind === 'network') {
      const transport = createObservedInProcessClient(server, (request) => {
        if (new URL(request.url).pathname === '/system/capabilities')
          throw new TypeError('Failed to fetch')
      })
      onTestFinished(installTestClient(transport))
    }
    if (kind === 'server')
      server.app.get('/system/capabilities', () =>
        Response.json(
          {
            code: 'system.CAPABILITIES_FAILED',
            message: 'Could not check capabilities.',
            why: 'The capability service failed.',
            fix: 'Try the server connection again.',
          },
          { status: 503 },
        ),
      )
    if (kind === 'schema')
      server.app.get('/system/capabilities', () => ({ nativePicker: 'invalid' }))
    const before = toast.getHistory().length
    const logs = recordClientLog('warn')
    const view = renderWithProviders(<PickerFixture />)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(toast.getHistory()).toHaveLength(before + 1))
    const shown = toast.getHistory().at(-1)!
    expect(shown).toMatchObject({
      type: 'error',
      title: 'Could not check file chooser availability',
      action: { label: 'Fix with AI' },
      description: expect.any(String),
    })
    expect(logs.events('platform.picker_capabilities.summary')).toHaveLength(1)
    expect(logs.events('platform.picker_capabilities.summary')[0]).toMatchObject({
      outcome: 'fallback',
      error: { why: expect.any(String), fix: expect.any(String) },
    })
    const failure = view.queryClient.getQueryState(entryPickerQueryKeys.capabilities)?.error
    const guidance = v.parse(v.object({ why: v.string(), fix: v.string() }), failure)
    const description = v.parse(v.object({ description: v.string() }), shown).description
    expect(description).toContain(guidance.why)
    expect(description).toContain(guidance.fix)
    view.rerender(<PickerFixture open={false} />)
    view.rerender(<PickerFixture />)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() => {
      const state = view.queryClient.getQueryState(entryPickerQueryKeys.capabilities)
      expect(state?.fetchStatus).toBe('idle')
      expect(state?.error).not.toBe(failure)
    })
    expect(toast.getHistory()).toHaveLength(before + 1)
    expect(logs.events('platform.picker_capabilities.summary')).toHaveLength(1)
    view.unmount()
    renderWithProviders(<PickerFixture />, { queryClient: view.queryClient })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() =>
      expect(view.queryClient.getQueryState(entryPickerQueryKeys.capabilities)?.fetchStatus).toBe(
        'idle',
      ),
    )
    expect(toast.getHistory()).toHaveLength(before + 1)
    expect(logs.events('platform.picker_capabilities.summary')).toHaveLength(1)
  },
)

test('a successful capability result resets the failure notice', async ({ server, client }) => {
  const identity = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  let failed = true
  server.app
    .get('/system/capabilities', () =>
      failed
        ? Response.json({ message: 'Capability service failed' }, { status: 503 })
        : Response.json(serverCapabilities(identity.environmentId)),
    )
    .compile()
  const before = toast.getHistory().length
  const logs = recordClientLog('warn')
  const view = renderWithProviders(<PickerFixture />)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  await waitFor(() =>
    expect(view.queryClient.getQueryState(entryPickerQueryKeys.capabilities)?.fetchStatus).toBe(
      'idle',
    ),
  )
  await waitFor(() => expect(toast.getHistory()).toHaveLength(before + 1))
  failed = false
  await act(async () => {
    await view.queryClient.invalidateQueries({ queryKey: entryPickerQueryKeys.capabilities })
  })
  await waitFor(() =>
    expect(view.queryClient.getQueryState(entryPickerQueryKeys.capabilityNotice)).toBeUndefined(),
  )
  failed = true
  await act(async () => {
    await view.queryClient.invalidateQueries({ queryKey: entryPickerQueryKeys.capabilities })
  })
  await waitFor(() => expect(toast.getHistory()).toHaveLength(before + 2))
  expect(logs.events('platform.picker_capabilities.summary')).toHaveLength(2)
})
