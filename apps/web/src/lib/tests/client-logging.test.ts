import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { activeServerOrigin, setActiveServerOrigin } from '@/lib/client'
import { environmentLogContext } from '@/lib/environments/state/log-context'
import { environmentIdSchema } from '@workspace/contracts'
import { createTestQueryClient } from '../../../test/render'
import { DEFAULT_PROVIDER_DRIVER_KIND, providerInstanceIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, beforeEach, vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import type { ActiveSettingsIntent } from '@workspace/client-core/settings/intent-store'
import { settingsMutationLogContext } from '@/features/settings/utils/mutation-observability'
import { log, observeClientOperation } from '@/lib/client-logging'
import { superviseSettingsStream } from '@/features/settings/hooks/use-settings-stream'
import { resetSettingsSnapshotAdmission } from '@/features/settings/state/snapshot-admission'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { createWideEventScope } from '@/lib/wide-event-scope'

const { emittedEvents } = vi.hoisted(() => ({
  emittedEvents: [] as EmittedClientEvent[],
}))

vi.mock('evlog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('evlog')>()

  return {
    ...actual,
    initLogger: vi.fn(),
    log: {
      debug: (event: Record<string, unknown>) => emit('debug', event),
      error: (event: Record<string, unknown>) => emit('error', event),
      info: (event: Record<string, unknown>) => emit('info', event),
      warn: (event: Record<string, unknown>) => emit('warn', event),
    },
  }
})

type EmittedClientEvent = {
  readonly event: Record<string, unknown>
  readonly level: string
}

beforeEach(() => {
  emittedEvents.length = 0
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'debug')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('assigns stable event ids and retains structured failure fields', async () => {
  log.info({ action: 'settings.read', area: 'settings', eventId: 'event-explicit' })
  log.info({ action: 'settings.read', area: 'settings' })

  const failure = Object.assign(new Error('Settings write was rejected.'), {
    code: 'settings.WRITE_CONTENDED',
    status: 409,
  })
  await expect(
    observeClientOperation(
      {
        action: 'settings.write',
        area: 'settings',
        mutationId: 'mutation-failed',
        target: 'user',
      },
      async () => Promise.reject(failure),
    ),
  ).rejects.toBe(failure)

  expect(emittedEvents).toHaveLength(3)
  expect(emittedEvents[0]?.event.eventId).toBe('event-explicit')
  expect(emittedEvents[1]?.event.eventId).toEqual(expect.any(String))
  expect(emittedEvents[1]?.event.eventId).not.toBe('event-explicit')
  expect(emittedEvents[2]?.event.eventId).not.toBe(emittedEvents[1]?.event.eventId)
  expect(emittedEvents[2]).toMatchObject({
    event: {
      action: 'settings.write',
      area: 'settings',
      error: {
        code: 'settings.WRITE_CONTENDED',
        message: 'Settings write was rejected.',
        name: 'Error',
        status: 409,
      },
      eventId: expect.any(String),
      mutationId: 'mutation-failed',
      outcome: 'error',
      runtime: 'browser',
      target: 'user',
    },
    level: 'warn',
  })
})

test('a failure logs the server-side status precedence and the head of a long message', async () => {
  const message = `${'a'.repeat(2_000)}tail`
  const failure = Object.assign(new Error(message), { status: 409, statusCode: 503 })
  await expect(
    observeClientOperation({ action: 'fs.read', area: 'fs' }, async () => Promise.reject(failure)),
  ).rejects.toBe(failure)

  expect(emittedEvents.at(-1)?.event.error).toEqual({
    message: 'a'.repeat(2_000),
    name: 'Error',
    status: 503,
  })
})

test('emits mutation metadata without values and redacts raw or path diagnostics', () => {
  const context = settingsMutationLogContext(settingsIntentWithPrivateValues())
  log.warn({
    absolutePath: '/Users/example/.platform/settings.json',
    action: 'settings.write',
    area: 'settings',
    eventId: 'event-sanitized',
    secret: 'provider-secret-value',
    text: '{"workbench.colorTheme":"light"}',
    ...context,
  })

  expect(emittedEvents).toEqual([
    {
      event: {
        level: 'warn',
        absolutePath: '[redacted]',
        action: 'settings.write',
        affectedIds: ['codex-private'],
        area: 'settings',
        clientSequence: 7,
        eventId: 'event-sanitized',
        initiator: 'settings.ui',
        mutationId: 'mutation-private',
        operationKinds: ['set', 'provider.setEnabled'],
        runtime: 'browser',
        environmentId: null,
        machine: 'local',
        secret: '[redacted]',
        settingIds: ['workbench.colorTheme', 'providers.instances'],
        target: 'user',
        text: '[redacted]',
      },
      level: 'warn',
    },
  ])

  const serialized = JSON.stringify(emittedEvents[0])
  expect(serialized).not.toContain('/Users/example')
  expect(serialized).not.toContain('provider-secret-value')
  expect(serialized).not.toContain('PRIVATE_PROVIDER_TOKEN')
  expect(serialized).not.toContain('private-config-value')
  expect(serialized).not.toContain('"workbench.colorTheme":"light"')
})

function emit(level: string, event: Record<string, unknown>) {
  emittedEvents.push({ event, level })
}

function settingsIntentWithPrivateValues(): ActiveSettingsIntent {
  const request: ActiveSettingsIntent['patch']['request'] = {
    mutationId: 'mutation-private',
    operations: [
      { key: 'workbench.colorTheme', kind: 'set', value: 'light' },
      {
        createIfMissing: {
          config: { privateConfig: 'private-config-value' },
          driverKind: DEFAULT_PROVIDER_DRIVER_KIND,
          environment: [{ name: 'PRIVATE_PROVIDER_TOKEN', value: '' }],
        },
        enabled: true,
        kind: 'provider.setEnabled',
        providerInstanceId: v.parse(providerInstanceIdSchema, 'codex-private'),
      },
    ],
    target: 'user',
  }
  return {
    intentId: request.mutationId,
    sequence: 7,
    patch: { owner: createTestQueryClient(), request, initiator: 'settings.ui' },
    enqueuedAt: 1,
    resources: [],
    settled: Promise.resolve('failed'),
    status: 'pending',
    transportSettled: false,
  }
}

test('delayed operations and inactive-owner work retain captured machine attribution', async () => {
  const previous = useEnvironmentsStore.getState()
  const previousOrigin = activeServerOrigin()
  const originA = 'http://localhost:39901'
  const originB = 'http://localhost:39902'
  const idA = v.parse(environmentIdSchema, '01900000-0000-4000-8000-000000000001')
  const idB = v.parse(environmentIdSchema, '01900000-0000-4000-8000-000000000002')
  useEnvironmentsStore.setState({
    entries: {
      [originA]: {
        ...createEnvironmentEntry(originA, originA),
        name: 'machine-a',
        environmentId: idA,
      },
      [originB]: {
        ...createEnvironmentEntry(originB, originA),
        name: 'machine-b',
        environmentId: idB,
      },
    },
  })
  const gate = Promise.withResolvers<void>()
  try {
    setActiveServerOrigin(originA)
    const delayed = observeClientOperation(
      { action: 'test.delayed', area: 'test' },
      () => gate.promise,
    )
    setActiveServerOrigin(originB)
    gate.resolve()
    await delayed
    await observeClientOperation(
      { ...environmentLogContext(originA), action: 'test.inactive', area: 'test' },
      async () => {},
    )
    await observeClientOperation(
      { environmentId: idA, action: 'test.explicit-owner', area: 'test' },
      async () => {},
    )
    log.info({ environmentId: idA, action: 'test.direct-owner', area: 'test' })
    const scope = createWideEventScope({
      environmentId: idA,
      action: 'test.scope-owner',
      area: 'test',
    })
    expect(scope.getContext()).toMatchObject({ environmentId: idA, machine: 'machine-a' })
    const events = emittedEvents.filter(({ event }) => event.area === 'test')
    expect(events).toHaveLength(4)
    for (const { event } of events)
      expect(event).toMatchObject({ environmentId: idA, machine: 'machine-a' })

    log.info({
      environmentId: idA,
      machine: 'captured-machine-name',
      action: 'test.explicit-machine',
      area: 'test',
    })
    expect(emittedEvents.at(-1)?.event.machine).toBe('captured-machine-name')
    log.info({ environmentId: null, action: 'test.unknown-owner', area: 'test' })
    expect(emittedEvents.at(-1)?.event).toMatchObject({ environmentId: null, machine: null })
  } finally {
    useEnvironmentsStore.setState(previous, true)
    setActiveServerOrigin(previousOrigin)
  }
})

test('a settings stream keeps its primary owner when it finishes under a remote workbench', async ({
  controlledClient,
}) => {
  const previous = useEnvironmentsStore.getState()
  const previousOrigin = activeServerOrigin()
  const queryClient = createTestQueryClient()
  const originA = originForQueryClient(queryClient)
  const originB = 'http://localhost:39903'
  const idA = v.parse(environmentIdSchema, '01900000-0000-4000-8000-000000000003')
  useEnvironmentsStore.setState({
    entries: {
      [originA]: {
        ...createEnvironmentEntry(originA, originA),
        name: 'machine-a',
        environmentId: idA,
      },
      [originB]: { ...createEnvironmentEntry(originB, originA), name: 'machine-b' },
    },
  })
  const abort = new AbortController()
  const supervisor = superviseSettingsStream(queryClient, abort.signal)
  try {
    await controlledClient.controller.waitForSettingsStreamRequest(1)
    setActiveServerOrigin(originB)
    abort.abort()
    await supervisor
    expect(emittedEvents.find(({ event }) => event.action === 'settings.stream')).toMatchObject({
      event: { environmentId: idA, machine: 'machine-a', outcome: 'aborted' },
    })
  } finally {
    abort.abort()
    await supervisor
    resetSettingsSnapshotAdmission(queryClient)
    queryClient.clear()
    useEnvironmentsStore.setState(previous, true)
    setActiveServerOrigin(previousOrigin)
  }
})
