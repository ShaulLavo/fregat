import type {
  ChatAttachmentUpload,
  InteractionMode,
  ModelSelection,
  RuntimeMode,
} from '@workspace/contracts'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'

export type ChatInputSubmitPayload = {
  attachments: ChatAttachmentUpload[]
  interactionMode: InteractionMode
  modelSelection: ModelSelection
  runtimeMode: RuntimeMode
  terminalContexts: readonly TerminalContextSelection[]
  text: string
}

/** `started`: sent, and the draft stays for the next message with its workspace choices. */
export type ChatInputSubmitResult = 'sent' | 'started' | 'queued' | 'rejected'
