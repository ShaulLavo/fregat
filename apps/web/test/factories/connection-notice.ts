import * as v from 'valibot'
import { environmentIdSchema, type ConnectionError } from '@workspace/contracts'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { createTestEnvironmentConnections } from './environment-connections'
import { activeServerOrigin, primaryServerOrigin, setActiveServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import type { ConnectedMachine } from '@/state/environment-connections'
import { makeTestServer } from '../server'
import { createInProcessClient, createObservedInProcessClient } from '../client'
import { installTestEnvironment } from './client-binding'

export const MACHINE_SETUP_ERROR = {
  code: 'machines.SSH_NOT_INSTALLED',
  message: 'Platform server is not installed for this SSH user.',
  why: 'The probe found no platform-server on PATH or in ~/.local/bin.',
  fix: 'Select Install server to put this server’s release on that machine.',
  action: 'install',
} satisfies ConnectionError

export const MACHINE_PROTOCOL_ERROR = {
  code: 'machines.SSH_PROTOCOL',
  message: 'The remote server speaks protocol 6, and this Platform needs protocol 7.',
  why: 'The server on that machine was started from a different Platform version.',
  fix: 'Select Update server to install this server’s release on that machine and reconnect.',
  action: 'update',
} satisfies ConnectionError

// The server withholds `action` from a newer remote: updating it would install an older release.
export const MACHINE_NEWER_PROTOCOL_ERROR = {
  code: 'machines.SSH_PROTOCOL',
  message: 'The remote server speaks protocol 8, and this Platform needs protocol 7.',
  why: 'The server on that machine was started from a different Platform version.',
  fix: 'Update this Platform server to the version on that machine, then Retry.',
} satisfies ConnectionError

export async function createConnectionNoticeFixture(
  beforeRequest?: (request: Request) => void | Promise<void>,
) {
  const previous = useEnvironmentsStore.getState()
  const primary = primaryServerOrigin()
  const remote = 'https://machine-notice.test'
  const previousOrigin = activeServerOrigin()
  const remoteServer = await makeTestServer({ filesystemWatch: false })
  const client = beforeRequest
    ? createObservedInProcessClient(remoteServer, beforeRequest)
    : createInProcessClient(remoteServer)
  const restoreEnvironment = await installTestEnvironment(remote, client)
  const environmentId = v.parse(
    environmentIdSchema,
    useEnvironmentsStore.getState().entries[remote]?.environmentId,
  )
  setActiveServerOrigin(previousOrigin)
  const connections = createTestEnvironmentConnections({
    'shaul-mac': { kind: 'origin', url: remote },
  })
  useEnvironmentsStore.setState({
    activeOrigin: primary,
    entries: {
      [primary]: {
        ...(previous.entries[primary] ?? createEnvironmentEntry(primary, primary)),
        phase: 'live',
        descriptor: null,
      },
      [remote]: { ...createEnvironmentEntry(remote, primary), environmentId, phase: 'blocked' },
    },
  })
  function update(change: Partial<ConnectedMachine>) {
    connections.store.setState(({ machines }) => ({
      machines: machines.map((machine) => ({ ...machine, ...change })),
    }))
  }
  update({
    environmentId,
    origin: remote,
    endpoint: remote,
    phase: 'blocked',
    lastError: MACHINE_SETUP_ERROR,
    lastErrorAt: 1,
  })
  return {
    connections,
    remote,
    update,
    selectRemote: () => useEnvironmentsStore.setState({ activeOrigin: remote }),
    selectLocal: () => useEnvironmentsStore.setState({ activeOrigin: primary }),
    async dispose() {
      connections.stop()
      restoreEnvironment()
      await remoteServer.cleanup()
    },
  }
}
