import type { QuestionAnswerRow } from '../utils/question-answer-history'
import { ChatAttachmentThumbnails } from './chat-attachment-thumbnails'

export function QuestionAnswerHistory({ rows }: { rows: readonly QuestionAnswerRow[] }) {
  return (
    <div className='space-y-2' data-question-answer-history>
      {rows.map((row) => (
        <div className='space-y-1' key={row.id}>
          {row.question && (
            <p className='text-muted-foreground text-xs whitespace-pre-wrap'>{row.question}</p>
          )}
          {row.answer && <p className='text-xs whitespace-pre-wrap'>{row.answer}</p>}
          <ChatAttachmentThumbnails attachments={row.attachments} />
        </div>
      ))}
    </div>
  )
}
