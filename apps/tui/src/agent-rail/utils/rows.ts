import type {
  SessionRailModel,
  SessionRailItem,
  SessionRailProject,
  SessionSearchMatches,
} from '@workspace/client-core/chat/rail/model'
import type { SessionId } from '@workspace/contracts'
import { worktreeSummary } from '@/worktrees/utils/summary'

export type RailRow =
  | { readonly kind: 'project'; readonly project: SessionRailProject }
  | { readonly kind: 'session'; readonly session: SessionRailItem }

export function railRows(
  model: SessionRailModel,
  marked: readonly SessionId[],
  scope: string | null,
  query: string,
  search: SessionSearchMatches = {},
) {
  const rows: { key: string; name: string; description: string; value: RailRow }[] = []
  const listed = new Set<string>()
  for (const section of model.sections) {
    for (const group of section.groups) {
      const project = group.project
      listed.add(project.groupKey)
      rows.push({
        key: group.key,
        name: `${group.collapsed ? '▸' : '▾'} ${project.title}`,
        description: `${section.title} · ${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}${group.hiddenCount ? ` · ${group.hiddenCount} hidden` : ''}`,
        value: { kind: 'project', project },
      })
      for (const session of group.sessions)
        rows.push({
          key: session.key,
          name: `${marked.includes(session.id) ? '☑' : ' '} ${session.unread ? '● ' : ''}${session.title}`,
          description: `${worktreeSummary(session.worktree, session.repositoryKind)} · ${search[session.key]?.snippet.replaceAll(/\s+/g, ' ') ?? section.title}${session.archived ? ' · archived' : ''}${session.origin === 'discovered' ? ' · imported' : ''}`,
          value: { kind: 'session', session },
        })
    }
  }
  for (const project of model.projects) {
    if (listed.has(project.groupKey) || (scope !== null && project.groupKey !== scope)) continue
    if (query && !project.title.toLowerCase().includes(query.toLowerCase())) continue
    rows.push({
      key: project.key,
      name: `▾ ${project.title}`,
      description: project.workspaceRoot,
      value: { kind: 'project', project },
    })
  }
  return rows
}
