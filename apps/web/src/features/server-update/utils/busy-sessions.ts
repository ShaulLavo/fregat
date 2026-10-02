import type { BusySession } from '@workspace/contracts'

export function sameBusySessions(left: readonly BusySession[], right: readonly BusySession[]) {
  return (
    left.length === right.length &&
    left.every(
      (session, index) =>
        session.sessionId === right[index]?.sessionId && session.state === right[index]?.state,
    )
  )
}
