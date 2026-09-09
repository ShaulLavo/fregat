import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot, flushSync } from '@opentui/react'

import { Application } from '@/components/application'
import type { SettingsSession } from '@/connection/state/session'

type FrameOptions = {
  session: SettingsSession
  path: string
  width: number
  height: number
  noColor: boolean
}

export async function writeFrame(options: FrameOptions) {
  const frame = await createTestRenderer({
    width: options.width,
    height: options.height,
    useThread: false,
  })
  const root = createRoot(frame.renderer)
  try {
    await options.session.refresh()
    const ready = options.session.getSnapshot()
    if (ready.kind === 'ready') await ready.chat.refresh()
    flushSync(() => {
      root.render(
        <Application session={options.session} noColor={options.noColor} onExit={() => {}} />,
      )
    })
    await frame.renderOnce()
    await frame.flush()
    await mkdir(dirname(options.path), { recursive: true })
    await writeFile(options.path, frame.captureCharFrame(), 'utf8')
    const state = options.session.getSnapshot()
    return (
      state.kind === 'ready' &&
      state.connection.kind === 'live' &&
      state.chat.getSnapshot().status === 'ready'
    )
  } finally {
    options.session.dispose()
    try {
      root.unmount()
    } finally {
      frame.renderer.destroy()
    }
  }
}
