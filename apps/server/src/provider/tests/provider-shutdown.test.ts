import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import {
  DEFAULT_RUNTIME_MODE,
  providerDriverKindSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../db/migrations'
import * as schema from '../../db/schema'
import { MOCK_ADAPTER_CAPABILITIES, MockProviderAdapter } from '../adapters/mock'
import type { ProviderDriver } from '../driver'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { ProviderService } from '../provider-service'
import { ProviderSessionDirectory } from '../provider-session-directory'

const DRIVER_KIND = v.parse(providerDriverKindSchema, 'sleeper')
const INSTANCE_ID = v.parse(providerInstanceIdSchema, 'sleeper-1')
const SESSION_ID = v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc')

/**
 * A driver whose instance owns a real child process, which is the only way to
 * prove the teardown chain (service → registry → driver) actually reaches the
 * thing that would otherwise be orphaned.
 */
function sleeperDriver(children: Bun.Subprocess[]): ProviderDriver<Record<string, never>> {
  return {
    capabilities: { ...MOCK_ADAPTER_CAPABILITIES, multiInstance: true },
    credentialPaths: () => [],
    create: async (input) => {
      const child = Bun.spawn(['sleep', '30'], {
        stderr: 'ignore',
        stdin: 'ignore',
        stdout: 'ignore',
      })
      children.push(child)
      const adapter = new MockProviderAdapter({
        driverKind: DRIVER_KIND,
        providerInstanceId: input.providerInstanceId,
      })

      return {
        adapter,
        dispose: async () => {
          await adapter.stopAll()
          child.kill()
          await child.exited
        },
      }
    },
    defaultConfig: () => ({}),
    displayName: 'Sleeper',
    driverKind: DRIVER_KIND,
    environment: () => [],
    parseConfig: () => ({}),
  }
}

describe('provider shutdown', () => {
  it('leaves no child process behind', async () => {
    const fixture = createFixture()
    const children: Bun.Subprocess[] = []
    const registry = new ProviderAdapterRegistry({ drivers: [sleeperDriver(children)] })
    await registry.reconcile([{ driverKind: DRIVER_KIND, providerInstanceId: INSTANCE_ID }])
    const service = new ProviderService({
      adapterRegistry: registry,
      sessionDirectory: new ProviderSessionDirectory(fixture.database),
    })
    const adapter = registry.getByInstance(INSTANCE_ID)
    await service.ensureRuntime({
      providerInstanceId: INSTANCE_ID,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      runtimePayload: {
        cwd: '/workspace',
        modelSelection: { model: 'gpt-5.5', providerInstanceId: INSTANCE_ID },
      },
      sessionId: SESSION_ID,
      runtimeEpoch: 'epoch-shutdown',
    })

    expect(children).toHaveLength(1)
    expect(isRunning(children[0]!.pid)).toBe(true)

    await service.shutdown()

    expect(isRunning(children[0]!.pid)).toBe(false)
    expect(await adapter.hasRuntime({ sessionId: SESSION_ID })).toBe(false)
    expect(registry.listInstances()).toEqual([])
    fixture.close()
  })
})

function isRunning(pid: number) {
  return Bun.spawnSync(['kill', '-0', String(pid)]).exitCode === 0
}

function createFixture() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)

  return {
    close: () => sqlite.close(),
    database,
  }
}
