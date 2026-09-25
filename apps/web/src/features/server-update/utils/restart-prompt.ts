import type { BusySession, BusySessionState } from '@workspace/contracts'

const BUSY_STATE_LABELS: Record<BusySessionState, string> = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting for your answer',
  rewinding: 'Rewinding',
  background: 'Running in the background',
  terminal: 'Running in a terminal',
}

export function busyStateLabel(state: BusySessionState): string {
  return BUSY_STATE_LABELS[state]
}

export function restartDescription(busy: readonly BusySession[]): string {
  const sessions = busy.length === 1 ? '1 session' : `${busy.length} sessions`
  return `Restarting interrupts ${sessions}. Queued messages start on the new server.`
}

/** Restarting drops an open approval or question, so the dialog says so when one is open. */
export function waitingNote(busy: readonly BusySession[]): string | null {
  const waiting = busy.filter((session) => session.state === 'waiting').length
  if (waiting === 0) return null
  if (waiting === 1) return 'A session waiting for your answer loses its open approval or question.'
  return 'Sessions waiting for your answer lose their open approval or question.'
}

/** The row's title recovers the truncated session title and adds its project. */
export function busySessionTitle(session: BusySession): string {
  if (!session.projectTitle) return session.title
  return `${session.title} · ${session.projectTitle}`
}

export function restartTooltip(release: string): string {
  return `Restarts the server into ${release}. Terminals restart too.`
}
