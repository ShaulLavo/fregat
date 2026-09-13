import {
  LanguageServerDocumentSyncController,
  type ApplyWorkspaceEditResult,
  type OnApplyWorkspaceEdit,
} from '@singapore-editor/lsp-plugin'
import { createContext, use } from 'react'

import type { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import { clientErrors } from '@/lib/structured-errors'

const unsupportedWorkspaceEditResult: ApplyWorkspaceEditResult = {
  code: 'workspace-edit-host-unavailable',
  message: 'Workspace edits are unavailable outside the workspace coordinator',
  status: 'failed',
}

const rejectWorkspaceEdit: OnApplyWorkspaceEdit = async () => unsupportedWorkspaceEditResult

export type WorkspaceEditHost = {
  readonly documentSyncController: LanguageServerDocumentSyncController
  readonly isOwnEvent: (writeId: string) => boolean
  readonly onApplyWorkspaceEdit: OnApplyWorkspaceEdit
}

const defaultWorkspaceEditHost: WorkspaceEditHost = {
  documentSyncController: new LanguageServerDocumentSyncController(),
  isOwnEvent: () => false,
  onApplyWorkspaceEdit: rejectWorkspaceEdit,
}

export const WorkspaceEditHostContext = createContext<WorkspaceEditHost>(defaultWorkspaceEditHost)

export const WorkspaceEditServiceContext = createContext<WorkspaceEditService | null>(null)

export function useWorkspaceEditHost(): OnApplyWorkspaceEdit {
  return use(WorkspaceEditHostContext).onApplyWorkspaceEdit
}

export function useWorkspaceEditEventClassifier(): WorkspaceEditHost['isOwnEvent'] {
  return use(WorkspaceEditHostContext).isOwnEvent
}

export function useWorkspaceDocumentSyncController(): LanguageServerDocumentSyncController {
  return use(WorkspaceEditHostContext).documentSyncController
}

export function useWorkspaceEditService(): WorkspaceEditService {
  const service = use(WorkspaceEditServiceContext)
  if (service) return service
  throw clientErrors.CONTEXT_MISSING({
    message: 'useWorkspaceEditService must be used within WorkspaceEditProvider',
  })
}

export function useOptionalWorkspaceEditService(): WorkspaceEditService | null {
  return use(WorkspaceEditServiceContext)
}
