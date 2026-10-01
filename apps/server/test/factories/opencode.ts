import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createTestApp, createTestDatabase } from '../server'
import { closeApp, orchestrationForApp } from '../../src/app'
import { ProviderAdapterRegistry } from '../../src/provider/provider-adapter-registry'
import { opencodeDriver } from '../../src/provider/drivers/opencode'
import { OPENCODE_DRIVER_KIND } from '../../src/provider/adapters/opencode'
import { providerInstanceIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { startOpenCodeHttpFixture } from './opencode-http'

export async function openCodeAppFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-opencode-app-'))
  const checkout = path.join(root, 'checkout')
  await mkdir(checkout)
  const http = startOpenCodeHttpFixture()
  const instanceId = v.parse(providerInstanceIdSchema, 'opencode-fixture')
  const registry = new ProviderAdapterRegistry({ drivers: [opencodeDriver] })
  await registry.reconcile([
    {
      driverKind: OPENCODE_DRIVER_KIND,
      providerInstanceId: instanceId,
      enabled: true,
      config: { serverUrl: http.url },
    },
  ])
  const database = createTestDatabase()
  const app = createTestApp({
    workspaceRoot: checkout,
    settings: { userFilePath: path.join(root, 'settings.json') },
    orchestration: {
      database: database.db,
      providerRuntime: true,
      attachmentsDir: path.join(root, 'attachments'),
      providerAdapterRegistry: registry,
      pullRequestLookup: null,
    },
  })
  const engine = orchestrationForApp(app)
  await engine.ready
  return {
    app,
    engine,
    http,
    checkout,
    instanceId,
    registry,
    close: async () => {
      await closeApp(app)
      await registry.dispose()
      http.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
