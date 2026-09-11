import { afterEach, beforeEach, vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import { reportClientError } from '@/lib/client-error-reporting'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { log, observeClientOperation } from '@/lib/client-logging'
import { notifyMutationError } from '@/features/git/utils/notify-mutation-error'
import { notifySaveError } from '@/features/settings/utils/notify-save-error'

const { emittedEvents, toastError } = vi.hoisted(() => ({
  emittedEvents: [] as EmittedClientEvent[],
  toastError: vi.fn(),
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

vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    error: toastError,
  },
}))

type EmittedClientEvent = {
  readonly event: Record<string, unknown>
  readonly level: string
}

beforeEach(() => {
  emittedEvents.length = 0
  toastError.mockClear()
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test('reports structured code and status without secret or absolute-path values', () => {
  const failure = Object.assign(new Error('Settings write was rejected.'), {
    code: 'settings.WRITE_CONTENDED',
    fix: 'Retry after another writer finishes.',
    status: 409,
    why: 'The write could not acquire the settings lease.',
  })

  reportClientError({
    area: 'settings',
    category: 'io_error',
    cause: failure,
    context: {
      absolutePath: '/Users/example/.platform/settings.json',
      authorization: 'Bearer provider-secret',
      mutationId: 'mutation-rejected',
      token: 'provider-token',
      body: 'private-body-value',
      content: 'private-content-value',
      cookie: 'private-cookie-value',
      password: 'private-password-value',
      patch: 'private-patch-value',
      secret: 'private-secret-value',
      'set-cookie': 'private-set-cookie-value',
      text: 'private-text-value',
      'x-api-key': 'private-x-api-key-value',
    },
    message: 'Settings write was rejected.',
    operation: 'settings.write',
  })

  expect(emittedEvents).toMatchObject([
    {
      event: {
        action: 'client.error',
        area: 'settings',
        cause: {
          code: 'settings.WRITE_CONTENDED',
          fix: 'Retry after another writer finishes.',
          message: 'Settings write was rejected.',
          name: 'Error',
          status: 409,
          why: 'The write could not acquire the settings lease.',
        },
        context: {
          absolutePath: '[redacted]',
          authorization: '[redacted]',
          mutationId: 'mutation-rejected',
          token: '[redacted]',
          body: '[redacted]',
          content: '[redacted]',
          cookie: '[redacted]',
          password: '[redacted]',
          patch: '[redacted]',
          secret: '[redacted]',
          'set-cookie': '[redacted]',
          text: '[redacted]',
          'x-api-key': '[redacted]',
        },
        eventId: expect.any(String),
        operation: 'settings.write',
        runtime: 'browser',
      },
      level: 'error',
    },
  ])

  const serialized = JSON.stringify(emittedEvents[0])
  expect(serialized).not.toContain('/Users/example')
  expect(serialized).not.toContain('provider-secret')
  expect(serialized).not.toContain('provider-token')
  for (const key of [
    'body',
    'content',
    'cookie',
    'password',
    'patch',
    'secret',
    'set-cookie',
    'text',
    'x-api-key',
  ]) {
    expect(serialized).not.toContain(`private-${key}-value`)
  }
})

test('redacts context before the shared logger and leaves report strings intact', () => {
  const reported = vi.spyOn(log, 'error')
  const privateKeys = [
    'body',
    'content',
    'cookie',
    'password',
    'patch',
    'secret',
    'set-cookie',
    'text',
    'x-api-key',
  ]
  const publicDetail = 'x'.repeat(2_500)

  reportClientError({
    area: 'settings',
    operation: 'settings.write',
    message: 'Settings write was rejected.',
    context: {
      ...Object.fromEntries(privateKeys.map((key) => [key, `private-${key}-value`])),
      publicDetail,
    },
  })

  expect(reported).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      context: {
        ...Object.fromEntries(privateKeys.map((key) => [key, '[redacted]'])),
        publicDetail,
      },
    }),
  )
  expect(emittedEvents[0]).toMatchObject({
    event: { context: { publicDetail: publicDetail.slice(0, 2_000) } },
  })
})

test('keeps one canonical settings failure without a parallel client error', async () => {
  const failure = Object.assign(new Error('Settings write was rejected.'), {
    code: 'settings.WRITE_CONTENDED',
    status: 409,
  })

  await expect(
    observeClientOperation(
      {
        action: 'settings.write',
        area: 'settings',
        mutationId: 'mutation-canonical',
        operationKinds: ['set'],
        settingIds: ['workbench.colorTheme'],
        target: 'user',
      },
      async () => Promise.reject(failure),
    ),
  ).rejects.toBe(failure)

  notifySaveError({
    discard: vi.fn(),
    error: failure,
    mutationId: 'mutation-canonical',
    retry: vi.fn(),
  })

  expect(emittedEvents).toHaveLength(1)
  expect(emittedEvents[0]).toMatchObject({
    event: {
      action: 'settings.write',
      area: 'settings',
      error: { code: 'settings.WRITE_CONTENDED', status: 409 },
      mutationId: 'mutation-canonical',
      operationKinds: ['set'],
      settingIds: ['workbench.colorTheme'],
      target: 'user',
    },
    level: 'warn',
  })
  expect(emittedEvents.some(({ event }) => event.action === 'client.error')).toBe(false)
  expect(toastError).toHaveBeenCalledOnce()
})

test('keeps one canonical raw-save failure when command reporting shows its toast', async () => {
  const failure = Object.assign(new Error('Settings kept changing before save.'), {
    code: 'settings.WRITE_CONTENDED',
    status: 503,
  })

  await expect(
    observeClientOperation(
      {
        action: 'settings.write-raw',
        area: 'settings',
        target: 'user',
        writeId: 'raw-save-contended',
      },
      async () => Promise.reject(failure),
    ),
  ).rejects.toBe(failure)

  reportError(toClientError(failure))

  expect(emittedEvents).toHaveLength(1)
  expect(emittedEvents[0]).toMatchObject({
    event: {
      action: 'settings.write-raw',
      area: 'settings',
      error: { code: 'settings.WRITE_CONTENDED', status: 503 },
      target: 'user',
      writeId: 'raw-save-contended',
    },
    level: 'warn',
  })
  expect(emittedEvents.some(({ event }) => event.action === 'client.error')).toBe(false)
  expect(toastError).toHaveBeenCalledOnce()
})

test('keeps one canonical git failure when the notifier shows its toast', async () => {
  const failure = Object.assign(new Error('Git command was rejected.'), {
    code: 'GIT_REPOSITORY_NOT_FOUND',
    status: 404,
  })

  await expect(
    observeClientOperation({ action: 'git.stage', area: 'git' }, async () =>
      Promise.reject(failure),
    ),
  ).rejects.toBe(failure)

  notifyMutationError(failure)

  expect(emittedEvents).toHaveLength(1)
  expect(emittedEvents[0]).toMatchObject({ event: { action: 'git.stage', area: 'git' } })
  expect(toastError).toHaveBeenCalledOnce()
})

test('reports a git failure raised outside the observed transport', () => {
  notifyMutationError(
    Object.assign(new Error('Git command was rejected.'), {
      code: 'GIT_REPOSITORY_NOT_FOUND',
      status: 404,
    }),
  )

  expect(emittedEvents).toHaveLength(1)
  expect(emittedEvents[0]).toMatchObject({ event: { action: 'client.error', area: 'git' } })
  expect(toastError).toHaveBeenCalledOnce()
})

function emit(level: string, event: Record<string, unknown>) {
  emittedEvents.push({ event, level })
}
