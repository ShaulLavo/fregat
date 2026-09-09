import type { ProjectId, SessionId, WorktreeId } from '@workspace/contracts'

export type AgentLocation = {
  readonly kind: 'agent'
  readonly projectId: ProjectId | null
  readonly sessionId: SessionId | null
  readonly worktreeId?: WorktreeId | null
}

export type StageTarget =
  | { readonly kind: 'draft'; readonly worktreeId: WorktreeId }
  | { readonly kind: 'conversation'; readonly sessionId: SessionId }
  | ({ readonly kind: 'terminal'; readonly worktreeId: WorktreeId; readonly terminalId: string } & (
      | { readonly face: 'shell'; readonly sessionId: SessionId | null }
      | { readonly face: 'agent'; readonly sessionId: SessionId }
    ))

export const agentHome: AgentLocation = { kind: 'agent', projectId: null, sessionId: null }
