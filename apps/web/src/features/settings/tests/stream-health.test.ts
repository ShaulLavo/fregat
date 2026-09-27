import { vi } from 'vitest'
import { saveSettings } from '@/features/settings/utils/api'
import { getClient } from '@/lib/client'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'
import { recordClientLog } from '../../../../test/factories/client-log'
import { superviseSettingsStream } from '@/features/settings/hooks/use-settings-stream'
import { resetSettingsSnapshotAdmission } from '@/features/settings/state/snapshot-admission'
import {
  SETTINGS_STREAM_MAX_FAILURES,
  type SettingsStreamStop,
} from '@workspace/client-core/settings/stream'

test('real server heartbeats keep settings open beyond the entire give-up window', async ({
  controlledClient,
}) => {
  const { controller } = controlledClient
  const queryClient = createTestQueryClient()
  const abort = new AbortController()
  const stops: SettingsStreamStop[] = []
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const supervisor = superviseSettingsStream(queryClient, abort.signal, {}, (stop) =>
    stops.push(stop),
  )
  try {
    await controller.waitForSettingsStreamRequest(1)
    await vi.waitFor(() => expect(queryClient.getQueryData(settingsKeys.document())).toBeDefined())
    for (let heartbeat = 0; heartbeat < 24; heartbeat += 1) {
      await vi.advanceTimersByTimeAsync(15_000)
      await delay(5)
    }
    expect(stops).toEqual([])
    expect(controller.settingsStreamRequestCount).toBe(1)
    expect(controller.settingsReadCount).toBe(1)
    expect(controller.settingsStreamAttemptCount).toBe(1)
    await saveSettings(
      {
        mutationId: 'after-heartbeats',
        target: 'user',
        operations: [{ kind: 'set', key: 'editor.fontSize', value: 29 }],
      },
      getClient(),
    )
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(settingsKeys.document())).toMatchObject({
        values: { 'editor.fontSize': 29 },
      }),
    )
  } finally {
    abort.abort()
    await supervisor
    vi.useRealTimers()
    resetSettingsSnapshotAdmission(queryClient)
    queryClient.clear()
  }
})

for (const mode of ['delayed failure', 'empty stream', 'failed read'] as const) {
  test(`a ${mode} never resets the failure series before a healthy frame`, async ({ client }) => {
    expect(client).toBeDefined()
    const queryClient = createTestQueryClient()
    const warn = recordClientLog('warn')
    const info = recordClientLog('info')
    const stops: SettingsStreamStop[] = []
    const abort = new AbortController()
    let attempts = 0
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let settled = false
    const supervisor = superviseSettingsStream(
      queryClient,
      abort.signal,
      {
        connect: async () => {
          attempts += 1
          if (mode === 'empty stream') return (async function* () {})()
          if (mode === 'failed read')
            return (async function* () {
              yield Promise.reject({ code: 'TEST_STREAM_FAILURE', status: 503 })
            })()
          await new Promise((resolve) => setTimeout(resolve, 2_000))
          throw { code: 'TEST_STREAM_FAILURE', status: 503 }
        },
        wait: async () => attempts <= SETTINGS_STREAM_MAX_FAILURES,
      },
      (stop) => stops.push(stop),
    ).finally(() => {
      settled = true
    })
    try {
      while (!settled) {
        await delay(5)
        await vi.advanceTimersByTimeAsync(2_000)
      }
      await supervisor
      expect(stops).toEqual([
        expect.objectContaining({
          reason: 'unreachable',
          failureCount: SETTINGS_STREAM_MAX_FAILURES,
        }),
      ])
      expect(attempts).toBe(SETTINGS_STREAM_MAX_FAILURES)
      expect(warn.events('settings.stream').map((event) => event.outcome)).toEqual([
        mode === 'empty stream' ? 'disconnected' : 'error',
        'gave-up',
      ])
      expect(info.events('settings.stream')).toEqual([])
    } finally {
      abort.abort()
      await supervisor
      vi.useRealTimers()
      resetSettingsSnapshotAdmission(queryClient)
      queryClient.clear()
    }
  })
}
