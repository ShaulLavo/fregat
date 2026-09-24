import { act } from 'react'
import { settingRowTitle } from '@workspace/client-core/settings/humanize'
import { matchingSettingIds } from '@workspace/client-core/settings/search'
import { Application } from '@/components/application'
import { createControlledInProcessTransport } from '../../../test/client'
import { createTestSettingsSession } from '../../../test/factories/session'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

test.for([
  { width: 60, height: 20 },
  { width: 40, height: 12 },
])(
  'keeps live and disconnected status readable at $width×$height',
  async ({ width, height }, { server }) => {
    const transport = createControlledInProcessTransport(server)
    const session = createTestSettingsSession(server, { createSocket: transport.createSocket })
    await session.refresh()
    const frame = await renderTui(
      <Application
        initialLocation={{ kind: 'settings', query: '' }}
        session={session}
        noColor
        onExit={() => {}}
      />,
      {
        width,
        height,
        useThread: false,
      },
    )
    const firstSetting = matchingSettingIds('')[0]
    try {
      await frame.renderOnce()
      expect(frame.captureCharFrame()).toContain('Live · ')
      await act(async () => {
        transport.sockets[0].serverClose({ code: 1006, wasClean: false })
      })
      await frame.renderOnce()
      expect(frame.captureCharFrame()).toContain('Disconnected · ')
      expect(frame.captureCharFrame()).toContain('Ctrl+R refresh')
      // The cached settings list stays on screen after the socket drops.
      expect(frame.captureCharFrame()).toContain(settingRowTitle(firstSetting))
    } finally {
      await frame.cleanup()
      session.dispose()
      await session.flush()
    }
  },
)
