import { AgentRow } from '@/features/chat/components/agent-row'
import type { ChatAgentNode } from '@/features/chat/utils/agents'

/** Nested lists, indented by padding, because nothing here is navigated as a tree. */
export function AgentTreeList({
  groupId,
  nested = false,
  nodes,
}: {
  groupId: string
  nested?: boolean
  nodes: readonly ChatAgentNode[]
}) {
  return (
    <ul className={nested ? 'pl-4' : undefined} data-agent-tree-level={nested ? 'child' : 'root'}>
      {nodes.map(({ children, entry }) => (
        <li key={entry.agent.threadId}>
          <AgentRow entry={entry} groupId={groupId} />
          {children.length > 0 ? <AgentTreeList groupId={groupId} nested nodes={children} /> : null}
        </li>
      ))}
    </ul>
  )
}
