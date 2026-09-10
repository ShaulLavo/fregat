import type { RPCSchema } from 'electrobun'
import type { PlatformPickOptions } from './bridge'

type PlatformPickResult = {
  paths: string[]
}

export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      pickEntry: {
        params: PlatformPickOptions
        response: PlatformPickResult
      }
    }
    messages: Record<string, never>
  }>
  webview: RPCSchema<{
    requests: Record<string, never>
    messages: Record<string, never>
  }>
}
