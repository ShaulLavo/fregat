import { createContext } from 'react'
import type { AttachTerminalRequest } from '@/host/attach'
import type { ClipboardImage } from '@/host/clipboard-image'

export type EditTextRequest = {
  readonly text: string
  readonly executable: string
  readonly signal: AbortSignal
  readonly filename?: string
}
export type HostActions = {
  readonly quit: () => void
  readonly suspend?: () => void
  readonly editText?: (request: EditTextRequest) => Promise<string>
  readonly attachTerminal?: (request: AttachTerminalRequest) => Promise<void>
  readonly readClipboardImage?: (signal: AbortSignal) => Promise<ClipboardImage | null>
}
export const HostActionsContext = createContext<HostActions | null>(null)
