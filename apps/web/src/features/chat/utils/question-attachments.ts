import type { UserInputQuestion } from '@workspace/contracts'
import type { UserInputAnswerDrafts } from '@workspace/client-core/chat/pending-user-input'
import type { ChatInputAttachment } from '@/features/chat/state/chat-input-draft-store'

export function questionDraftsWithAttachments(
  questions: readonly UserInputQuestion[],
  drafts: UserInputAnswerDrafts,
  images: Readonly<Record<string, readonly ChatInputAttachment[]>>,
  blocked: boolean,
): UserInputAnswerDrafts {
  return Object.fromEntries(
    questions.map((question) => [
      question.id,
      {
        ...drafts[question.id],
        attachmentCount: images[question.id]?.length ?? 0,
        attachmentsBlocked: blocked,
      },
    ]),
  )
}
