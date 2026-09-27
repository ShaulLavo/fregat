import type {
  ChatAttachmentUpload,
  InteractionMode,
  ModelSelection,
  RuntimeMode,
} from '@workspace/contracts'
import type { SentReviewComment } from '@workspace/client-core/chat/review-comments'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'

export type ChatInputSubmitPayload = {
  attachments: ChatAttachmentUpload[]
  interactionMode: InteractionMode
  modelSelection: ModelSelection
  /** Composed ahead of the text only when the message is sent. */
  reviewComments?: readonly SentReviewComment[]
  runtimeMode: RuntimeMode
  terminalContexts: readonly TerminalContextSelection[]
  text: string
}

/** `started`: sent, and the draft stays for the next message with its workspace choices. */
export type ChatInputSubmitResult = 'sent' | 'started' | 'queued' | 'rejected'
