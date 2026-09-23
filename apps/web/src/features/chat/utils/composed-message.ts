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

export type ChatInputSubmitResult = 'sent' | 'queued' | 'rejected'
