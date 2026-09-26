import type { ScopedSessionRef } from '@workspace/contracts'

import { BackgroundTasksButton } from '@/features/chat/components/background-tasks-button'
import { GoalButton } from '@/features/chat/components/goal-button'
import { ReviewButton } from '@/features/chat/components/review-button'
import { SchedulesButton } from '@/features/chat/components/schedules-button'
import { SessionToolsButton } from '@/features/chat/components/session-tools-button'

/** A session's live controls in either chat header: review, background work, goal, schedules, tools. */
export function SessionControls({
  rootPath,
  sessionRef,
}: {
  /** The checkout a review reads; no review button without one. */
  readonly rootPath: string | null
  readonly sessionRef: ScopedSessionRef
}) {
  return (
    <>
      {rootPath ? <ReviewButton rootPath={rootPath} sessionRef={sessionRef} /> : null}
      <BackgroundTasksButton sessionRef={sessionRef} />
      <GoalButton sessionRef={sessionRef} />
      <SchedulesButton sessionRef={sessionRef} />
      <SessionToolsButton sessionRef={sessionRef} />
    </>
  )
}
