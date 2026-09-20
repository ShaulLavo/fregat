import type { ProviderUserInputAnswers, UserInputAttachments } from '@workspace/contracts'
import { attachmentFilePath } from '../attachments/store'
import { createInternalError } from '../observability/structured-errors'

export async function appendUserInputAttachmentPaths(
  answers: ProviderUserInputAnswers,
  attachments: UserInputAttachments | undefined,
  attachmentsDir: string,
): Promise<ProviderUserInputAnswers> {
  const result = { ...answers }
  for (const [questionId, entries] of Object.entries(attachments ?? {})) {
    const references: string[] = []
    for (const attachment of entries) {
      const filePath = attachmentFilePath({ attachmentsDir, attachment })
      if (!filePath || !(await Bun.file(filePath).exists()))
        throw createInternalError(`Attachment ${attachment.name} is unavailable. Attach it again.`)
      references.push(
        `Attached ${attachment.type} ${JSON.stringify(attachment.name)}: ${JSON.stringify(filePath)}`,
      )
    }
    if (!references.length) continue
    const answer = result[questionId]
    const text = references.join('\n')
    if (Array.isArray(answer)) result[questionId] = [...answer, text]
    else result[questionId] = answer ? `${answer}\n\n${text}` : text
  }
  return result
}
