import { Application } from '@/components/application'
import { rememberWorkbench, type WorkbenchLocation } from '@/workbench/utils/location'
import type { HostActions } from '@/host/providers/actions-context'
import { createTuiError } from '@/host/utils/structured-errors'
import { createControlledInProcessTransport } from '../client'
import type { TestServer } from '../server'
import type { ServiceSocket } from '@/connection/utils/service-socket'
import { renderTui } from '../render'
import { createTestSettingsSession } from './session'

export async function createWorkbenchFrame(
  server: TestServer,
  {
    location,
    width = 132,
    height = 40,
    onEditText,
    createServiceSocket,
  }: {
    readonly location: WorkbenchLocation
    readonly width?: number
    readonly height?: number
    readonly onEditText?: HostActions['editText']
    readonly createServiceSocket?: (url: string) => ServiceSocket
  },
) {
  const transport = createControlledInProcessTransport(server)
  const session = createTestSettingsSession(server, {
    createSocket: transport.createSocket,
    ...(createServiceSocket ? { createServiceSocket } : {}),
  })
  await session.refresh()
  const ready = session.getSnapshot()
  if (ready.kind !== 'ready')
    throw createTuiError(
      'Test session did not connect.',
      'Inspect the real fixture server connection.',
    )
  rememberWorkbench(ready.storage, location)
  const frame = await renderTui(
    <Application session={session} onExit={() => {}} onEditText={onEditText} noColor />,
    { width, height, useThread: false, kittyKeyboard: true },
  )
  return {
    session,
    frame,
    transport,
    async cleanup() {
      await frame.cleanup()
      session.dispose()
      await session.flush()
    },
  }
}
