import { onTestFinished } from 'vitest'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { fakeSsh } from '../../../server/test/factories/ssh'
import { createInProcessClient } from '../client'
import { makeTestServer } from '../server'
import { createFederationHarness } from './federation'

export async function createSshEnvironmentFixture() {
  const remote = await makeTestServer({ persistentDatabase: true, filesystemWatch: false })
  const descriptor = v.parse(
    healthDescriptorSchema,
    (await createInProcessClient(remote).health.get()).data,
  )
  const boundary = await fakeSsh({ descriptor, slowProbe: true })
  const children: Array<ReturnType<typeof boundary.spawn>> = []
  const primary = await makeTestServer({
    filesystemWatch: false,
    machines: {
      spawn: (command) => {
        const child = boundary.spawn(command)
        children.push(child)
        return child
      },
      fetcher: boundary.fetcher,
      localPort: boundary.localPort,
    },
  })
  onTestFinished(() => primary.cleanup())
  const harness = await createFederationHarness(primary, remote)
  return { ...harness, boundary, children }
}
