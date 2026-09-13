import { createDesktopError } from './structured-errors'

import { Electroview } from 'electrobun/view'
import type { DesktopRPC } from '../shared/rpc'
import type { PlatformBridge } from '../shared/bridge'
import { readShellHandoff } from '../shared/window'

const rpc = Electroview.defineRPC<DesktopRPC>({
  maxRequestTime: Infinity,
  handlers: {
    requests: {},
    messages: {},
  },
})

// Installed before the Electroview below, and reading nothing but the handoff
// the bun process wrote above this script: the web layer decides its floor and
// its wallpaper from `backdrop` before it paints a single frame, so that answer
// must not wait on — or be lost to — the RPC transport coming up.
const handoff = readShellHandoff()

window.platformBridge = {
  backdrop: handoff.backdrop,
  platform: handoff.platform,
  colorScheme: handoff.colorScheme,
  pickEntry: async (options) => {
    const client = electroview.rpc
    if (!client) throw createDesktopError('Electrobun RPC is unavailable')

    const result = await client.request.pickEntry(options)
    return result.paths
  },
} satisfies PlatformBridge

const electroview = new Electroview({ rpc })

declare global {
  interface Window {
    platformBridge?: PlatformBridge
  }
}
