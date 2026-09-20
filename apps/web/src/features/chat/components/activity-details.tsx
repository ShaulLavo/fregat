import { QuestionAnswerHistory } from './question-answer-history'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import { workRowSections } from '@/features/chat/utils/work-row'
import { ActivityDetailSection } from '@/features/chat/components/activity-detail-section'

export function ActivityDetails({ activity }: { activity: ChatWorkLogEntry }) {
  if (activity.questionAnswers?.length)
    return <QuestionAnswerHistory rows={activity.questionAnswers} />
  return (
    <div className='ml-4 space-y-2 py-2 pl-3'>
      {workRowSections(activity).map(({ label, value }) => (
        <ActivityDetailSection activityId={activity.id} key={label} label={label} value={value} />
      ))}
    </div>
  )
}
