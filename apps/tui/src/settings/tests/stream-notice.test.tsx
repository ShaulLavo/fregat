import { vi } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { act } from 'react'
import { Application } from '@/components/application'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { submitPaletteSearch } from '../../../test/palette'
import { createTestSettingsSession } from '../../../test/factories/session'
import { failingSettingsStream } from '../../../test/factories/settings-stream'
import { SETTINGS_STREAM_MAX_FAILURES } from '@workspace/client-core/settings/stream'
import { writeSettings } from '@workspace/client-core/settings/write'

for (const mode of ['unreachable', 'unreadable'] as const) {
  test(`settings ${mode} is visible while orchestration stays live`, async ({ server, client }) => {
    const transport = failingSettingsStream(server, mode)
    const events: Record<string, unknown>[] = []
    const session = createTestSettingsSession(server, {
      client: transport.client,
      record: (event) => events.push(event),
    })
    const frame = await renderTui(
      <Application
        session={session}
        initialLocation={{ kind: 'settings', query: '' }}
        onExit={() => {}}
        noColor
      />,
      {
        width: 110,
        height: 32,
        useThread: false,
        kittyKeyboard: true,
      },
    )
    try {
      await act(async () => {
        await session.refresh()
      })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await act(async () => {
        for (let i = 0; i < 300 && !events.some((event) => event.outcome === 'gave-up'); i += 1) {
          await delay(5)
          await vi.advanceTimersByTimeAsync(5_000)
        }
      })
      vi.useRealTimers()
      await frame.renderOnce()
      expect(session.getSnapshot()).toMatchObject({ kind: 'ready', connection: { kind: 'live' } })
      expect(events.some((event) => event.outcome === 'gave-up')).toBe(true)
      expect(transport.attempts).toBe(mode === 'unreadable' ? 1 : SETTINGS_STREAM_MAX_FAILURES)
      expect(frame.captureCharFrame()).toContain('Settings stopped syncing.')
      expect(frame.captureCharFrame()).toContain(
        mode === 'unreadable' ? 'Update the TUI and restart' : 'Reconnect to retry',
      )
      transport.recover()
      await submitPaletteSearch(frame, '>Reconnect')
      await expect.poll(() => session.getSnapshot().kind).toBe('ready')
      await frame.renderOnce()
      expect(frame.captureCharFrame()).not.toContain('Settings stopped syncing.')
      await writeSettings({
        client,
        request: {
          mutationId: 'after-settings-reconnect',
          target: 'user',
          operations: [{ kind: 'set', key: 'editor.fontSize', value: 27 }],
        },
      })
      await expect
        .poll(() => {
          const state = session.getSnapshot()
          return state.kind === 'ready'
            ? state.owner.readSettingsMirror()['editor.fontSize']
            : undefined
        })
        .toBe(27)
    } finally {
      vi.useRealTimers()
      await frame.cleanup()
      session.dispose()
      await session.flush()
    }
  })
}
