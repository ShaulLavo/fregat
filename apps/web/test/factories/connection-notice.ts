import * as v from 'valibot'
import { environmentIdSchema } from '@workspace/contracts'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { createTestEnvironmentConnections } from './environment-connections'
import { activeServerOrigin, primaryServerOrigin, setActiveServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import type { ConnectedMachine } from '@/state/environment-connections'
import { makeTestServer } from '../server'
import { createInProcessClient, createObservedInProcessClient } from '../client'
import { installTestEnvironment } from './client-binding'

export const MACHINE_SETUP_ERROR =
  'The SSH machine could not be reached. Platform server is not installed for this SSH user. Run bun run server:install from a prepared Platform checkout on this machine, then connect again. Check the SSH connection. Install the server for that SSH user with bun run server:install from a prepared Platform checkout.'

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
