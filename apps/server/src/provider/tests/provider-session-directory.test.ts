import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import {
  DEFAULT_PROVIDER_DRIVER_KIND,
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  sessionIdSchema,
} from '@workspace/contracts'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../../db/migrations'
import * as schema from '../../db/schema'
import { ProviderSessionDirectory } from '../provider-session-directory'

describe('ProviderSessionDirectory', () => {
  it('merges runtime payloads and preserves resume cursors on upsert', () => {
    const fixture = createFixture()
    const directory = new ProviderSessionDirectory(fixture.database)
    const sessionId = v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc')

    directory.upsert({
      adapterKey: 'codex',
      providerDriverKind: DEFAULT_PROVIDER_DRIVER_KIND,
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      providerResumeCursor: { cursor: 'cursor-1' },
      runtimeMode: DEFAULT_RUNTIME_MODE,
      runtimePayload: {
        cwd: '/workspace',
        modelSelection: {
          model: 'gpt-5-codex',
          providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
        },
      },
      runtimeEpoch: 'epoch-test',
      sessionId,
    })
    directory.upsert({
      providerDriverKind: DEFAULT_PROVIDER_DRIVER_KIND,
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      runtimePayload: { interactionMode: 'plan' },
      sessionId,
    })

    const binding = directory.getBinding(sessionId)

    expect(binding?.providerResumeCursor).toEqual({ cursor: 'cursor-1' })
    expect(binding?.runtimePayload).toEqual({
      interactionMode: 'plan',
      cwd: '/workspace',
      modelSelection: {
        model: 'gpt-5-codex',
        providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      },
    })
    fixture.close()
  })

  it('drops payload keys that are not part of the runtime payload schema', () => {
    const fixture = createFixture()
    const directory = new ProviderSessionDirectory(fixture.database)
    const sessionId = v.parse(sessionIdSchema, '8b716256-a1e7-5889-bb07-546edbc11342')

    directory.upsert({
      providerDriverKind: DEFAULT_PROVIDER_DRIVER_KIND,
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      runtimePayload: { cwd: '/workspace' },
      runtimeEpoch: 'epoch-test',
      sessionId,
    })
    // A key nothing declares — what a typo looks like once it reaches SQLite.
    fixture.database
      .update(schema.providerSessionRuntime)
      .set({ runtimePayloadJson: JSON.stringify({ cwd: '/workspace', modelSelction: 'oops' }) })
      .where(eq(schema.providerSessionRuntime.sessionId, sessionId))
      .run()

    expect(directory.getBinding(sessionId)?.runtimePayload).toEqual({ cwd: '/workspace' })
    fixture.close()
  })
})

function createFixture() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)

  return {
    close: () => sqlite.close(),
    database,
  }
}
