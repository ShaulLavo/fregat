import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import type { ConnectionError } from '@workspace/contracts'
import { MachineConnectionRows } from '@/features/chat-mode/components/machine-connection-rows'
import { PickerDialog } from '@/features/environments/components/picker-dialog'
import { MachineRow } from '@/features/settings/components/machine-row'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { environmentMutationKeys } from '@/lib/environments/utils/mutation-keys'
import { createObservedInProcessClient } from '../../../test/client'
import { installTestClient } from '../../../test/factories/client-binding'
import {
  createConnectionNoticeFixture,
  MACHINE_PROTOCOL_ERROR,
  MACHINE_SETUP_ERROR,
} from '../../../test/factories/connection-notice'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'

const machine = { kind: 'ssh', target: 'shaul-mac' } as const

async function sshMachineWith(lastError: ConnectionError) {
  const fixture = await createConnectionNoticeFixture()
  onTestFinished(fixture.dispose)
  fixture.update({ config: machine, lastError })
  fixture.selectRemote()
  return fixture
}

function renderEverywhere(connections: Awaited<ReturnType<typeof sshMachineWith>>['connections']) {
  const rail = renderWithProviders(<MachineConnectionRows />, { connections })
  const row = renderWithProviders(
    <MachineRow name='shaul-mac' machine={machine} disabled={false} />,
    { connections },
  )
  return { rail, row }
}

test.for([
  { error: MACHINE_PROTOCOL_ERROR, action: 'Update server' },
  { error: MACHINE_SETUP_ERROR, action: 'Install server' },
])(
  '$error.code offers $action in the notice, Settings and the picker',
  async ({ error, action }) => {
    const { connections } = await sshMachineWith(error)
    const { rail, row } = renderEverywhere(connections)
    const name = `${action} on shaul-mac`
    expect(screen.getAllByRole('button', { name })).toHaveLength(2)
    rail.unmount()
    row.unmount()
    renderWithProviders(<PickerDialog mode='connect' onClose={() => {}} />, { connections })
    expect(screen.getByRole('button', { name })).toBeEnabled()
  },
)

test('other machine errors offer no update', async () => {
  const { connections } = await sshMachineWith({
    code: 'machines.SSH_IDENTITY',
    message: 'The SSH machine identity changed.',
  })
  renderEverywhere(connections)
  expect(screen.queryByRole('button', { name: /server on shaul-mac/ })).toBeNull()
})

test('the update’s pending state comes from the mutation cache, and its failure lands on the machine', async ({
  server,
}) => {
  const requests: string[] = []
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const client = createObservedInProcessClient(server, async (request) => {
    const { pathname } = new URL(request.url)
    if (!pathname.endsWith('/update')) return
    requests.push(pathname)
    await held
  })
  onTestFinished(installTestClient(client))
  const { connections } = await sshMachineWith(MACHINE_PROTOCOL_ERROR)
  renderEverywhere(connections)
  const key = { mutationKey: environmentMutationKeys.machine('update', 'shaul-mac') }

  const [notice, row] = screen.getAllByRole('button', { name: 'Update server on shaul-mac' })
  await userEvent.click(notice!)
  await waitFor(() => expect(requests).toEqual(['/machines/shaul-mac/update']))
  expect(primaryQueryClient().isMutating(key)).toBe(1)
  expect(notice).toBeDisabled()
  expect(row).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Retry now' })).toBeDisabled()

  release()
  // The primary has no machine by that name, so the route refuses and the machine carries why.
  await waitFor(() =>
    expect(connections.store.getState().machines[0]?.lastError?.code).toBe('machines.SSH_SETTINGS'),
  )
  expect(primaryQueryClient().isMutating(key)).toBe(0)
  expect(screen.queryByRole('button', { name: 'Update server on shaul-mac' })).toBeNull()
  expect(requests).toHaveLength(1)
})
