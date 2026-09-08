import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as baseTest } from 'vitest'
import { createMetadataDatabase, type MetadataDatabaseHandle } from '../../src/db/client'
import { testSettingsOptions } from '../../src/settings/testing'
import { closeTestApps, createTestApp } from '../server'

type WorkspaceAddressFixture = {
  root: string
  directory: string
  openApp: (workspaceRoot?: string) => ReturnType<typeof createTestApp>
  closeApps: () => Promise<void>
}

export const test = baseTest.extend<{ workspace: WorkspaceAddressFixture }>({
  // eslint-disable-next-line no-empty-pattern -- Vitest fixture callbacks must destructure the context object.
  workspace: async ({}, provide) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'platform-workspace-address-'))
    const root = path.join(directory, 'root')
    await mkdir(root)
    const databases: MetadataDatabaseHandle[] = []
    const closeApps = async () => {
      await closeTestApps()
      for (const database of databases.splice(0)) database.close()
    }
    const openApp = (workspaceRoot = root) => {
      const database = createMetadataDatabase({
        databasePath: path.join(directory, 'metadata.sqlite'),
      })
      databases.push(database)
      return createTestApp({
        auth: { allowedOrigins: ['http://localhost:5173'] },
        metadataDatabase: database,
        orchestration: { database: database.db },
        settings: testSettingsOptions(directory),
        watch: false,
        workspaceEditJournalRoot: path.join(directory, 'journal'),
        workspaceRoot,
      })
    }

    try {
      await provide({ root, directory, openApp, closeApps })
    } finally {
      await closeApps()
      await rm(directory, { recursive: true, force: true })
    }
  },
})

export function workspaceRequest(
  app: ReturnType<typeof createTestApp>,
  pathname: string,
  body?: object,
) {
  return app.handle(
    new Request(`http://local${pathname}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      method: body === undefined ? 'GET' : 'POST',
    }),
  )
}
