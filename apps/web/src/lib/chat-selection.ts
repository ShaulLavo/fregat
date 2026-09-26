import type { EnvironmentId, ProjectId, SessionId } from '@workspace/contracts'

export type ChatSelection =
  | { readonly kind: 'auto' }
  | {
      readonly kind: 'draft'
      readonly draftId?: string
      readonly environmentId: EnvironmentId
      readonly projectId: ProjectId
    }
  | {
      readonly kind: 'session'
      readonly environmentId: EnvironmentId
      readonly projectId: ProjectId
      readonly sessionId: SessionId
    }
