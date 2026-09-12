import { machineKeys } from '@/features/environments/utils/query-keys'
import { SshHostList } from '@/features/environments/components/ssh-host-list'
import { primaryServerOrigin } from '@/lib/client'
import { createObservedInProcessClient } from '../../../../test/client'
import { installTestClient } from '../../../../test/factories/client-binding'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, onTestFinished } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MachineForm } from '@/components/machine-form'
import { fetchSettings } from '@/features/settings/utils/api'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { createFederationHarness } from '../../../../test/factories/federation'
import { writeSshConfig } from '../../../../test/factories/ssh-config'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

afterEach(() => primaryQueryClient().clear())

test('lists and filters SSH aliases, then saves the selected target', async ({
  server,
  client,
}) => {
  await writeSshConfig(
    server.root,
    'Host Build.Box backup\n  HostName 100.70.1.2\nHost * !excluded\n  User shaul\n',
  )
  renderWithProviders(<MachineForm onCancel={() => {}} onSaved={() => {}} />)
  expect(await screen.findByRole('button', { name: 'Build.Box' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'backup' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '*' })).toBeNull()
  await userEvent.type(screen.getByLabelText('SSH target'), 'build')
  expect(screen.queryByRole('button', { name: 'backup' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Build.Box' }))
  expect(screen.getByLabelText('SSH target')).toHaveValue('Build.Box')
  await userEvent.click(screen.getByRole('button', { name: 'Add machine' }))
  await waitFor(async () =>
    expect((await fetchSettings(undefined, client)).values['environments.machines']).toEqual({
      'build-box': { kind: 'ssh', target: 'Build.Box' },
    }),
  )
})

test('an empty SSH config still allows a manually entered address', async ({ client }) => {
  renderWithProviders(<MachineForm onCancel={() => {}} onSaved={() => {}} />)
  expect(await screen.findByText('No hosts in SSH config')).toBeVisible()
  await userEvent.type(screen.getByLabelText('SSH target'), 'user@new-host')
  await userEvent.click(screen.getByRole('button', { name: 'Add machine' }))
  await waitFor(async () =>
    expect((await fetchSettings(undefined, client)).values['environments.machines']).toEqual({
      'user-new-host': { kind: 'ssh', target: 'user@new-host' },
    }),
  )
})

test('failed discovery is distinct from an empty config and can be retried', async ({
  server,
  client,
}) => {
  void client
  const config = path.join(server.root, '.ssh/config')
  await mkdir(config, { recursive: true })
  renderWithProviders(<MachineForm onCancel={() => {}} onSaved={() => {}} />)
  expect(await screen.findByText('Could not read SSH hosts')).toBeVisible()
  expect(screen.queryByText('No hosts in SSH config')).toBeNull()
  expect(screen.getByLabelText('SSH target')).toBeEnabled()
  await rm(config, { recursive: true })
  await writeSshConfig(server.root, 'Host repaired\n')
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: 'repaired' })).toBeVisible()
})

test('reopening the form refreshes edited SSH config', async ({ server, client }) => {
  void client
  await writeSshConfig(server.root, 'Host before\n')
  const first = renderWithProviders(<MachineForm onCancel={() => {}} onSaved={() => {}} />)
  await screen.findByRole('button', { name: 'before' })
  first.unmount()
  await writeSshConfig(server.root, 'Host after\n')
  renderWithProviders(<MachineForm onCancel={() => {}} onSaved={() => {}} />)
  expect(await screen.findByRole('button', { name: 'after' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'before' })).toBeNull()
})

test('uses the primary machine SSH config while another machine is active', async ({ server }) => {
  const h = await createFederationHarness(server)
  await writeSshConfig(h.serverA.root, 'Host primary-host\n')
  await writeSshConfig(h.serverB.root, 'Host remote-host\n')
  h.application.activateEnvironment(h.originB)
  renderWithProviders(<MachineForm onCancel={() => {}} onSaved={() => {}} />, {
    connections: h.connections,
  })
  expect(await screen.findByRole('button', { name: 'primary-host' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'remote-host' })).toBeNull()
})

test('disables SSH Retry while a retained discovery result is being refetched', async ({
  server,
  client,
}) => {
  void client
  const pending = Promise.withResolvers<void>()
  onTestFinished(() => pending.resolve())
  let requests = 0
  const observed = createObservedInProcessClient(server, (request) => {
    if (new URL(request.url).pathname !== '/machines/ssh-hosts') return
    requests += 1
    if (requests >= 3) return pending.promise
  })
  onTestFinished(installTestClient(observed))
  const config = await writeSshConfig(server.root, 'Host original\n')
  renderWithProviders(<SshHostList value='' onSelect={() => {}} />)
  await screen.findByRole('button', { name: 'original' })
  await rm(config)
  await mkdir(config)
  await act(() =>
    primaryQueryClient().invalidateQueries({
      queryKey: machineKeys.sshHosts(primaryServerOrigin()),
    }),
  )
  await screen.findByText('Could not read SSH hosts')
  await rm(config, { recursive: true })
  await writeSshConfig(server.root, 'Host repaired\n')
  const retry = screen.getByRole('button', { name: 'Retry' })
  await userEvent.click(retry)
  await waitFor(() => expect(retry).toBeDisabled())
  await userEvent.click(retry)
  expect(requests).toBe(3)
  await act(async () => pending.resolve())
  expect(await screen.findByRole('button', { name: 'repaired' })).toBeVisible()
})
