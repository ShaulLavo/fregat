import { test as base } from './fixtures'
import { makeTestServer, type TestServer } from './server'
import { createWorkspaceEditFaults } from './factories/workspace-edit'

export const test = base.extend<{
  editFaults: ReturnType<typeof createWorkspaceEditFaults>
  server: TestServer
}>({
  // Vitest discovers fixture dependencies from destructured parameters.
  // eslint-disable-next-line no-empty-pattern
  editFaults: async ({}, provide) => {
    await provide(createWorkspaceEditFaults())
  },
  server: async ({ editFaults }, provide) => {
    const server = await makeTestServer({ workspaceEditDriver: editFaults.driver })
    try {
      await provide(server)
    } finally {
      await server.cleanup()
    }
  },
})

export { expect } from 'vitest'
