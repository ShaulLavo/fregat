import * as v from 'valibot'
import { chatAttachmentSchema } from '@workspace/contracts'
import type { SessionTitleMessage } from '../../src/orchestration/title-context'

export const titleAttachment = (id: string) =>
  v.parse(chatAttachmentSchema, {
    type: 'image',
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 10,
  })
export const titleMessages = (count: number, length: number): SessionTitleMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `${index}:first ${'x'.repeat(length)} final:${index}`,
    attachments: [titleAttachment(String(index))],
  }))
