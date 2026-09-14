import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'

/** The whole breadcrumb the stage header truncates: project › worktree › session. */
export function stageTitle(projectTitle: string | null, session: SessionRailItem | null) {
  const parts = [projectTitle]
  if (session) parts.push(session.branch ?? session.worktreePath, session.title)

  return parts.filter(Boolean).join(' › ')
}
