import { WorkspaceTextChangesContext } from '@/lib/workspace-edits/providers/context'
import type { ReactNode } from 'react'

import {
  WorkspaceEditHostContext,
  WorkspaceEditServiceContext,
  type WorkspaceEditHost,
} from '@/features/editor/providers/workspace-edit-context'
import type { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'

export function WorkspaceEditProvider({
  children,
  host,
  service,
}: {
  readonly children: ReactNode
  readonly host: WorkspaceEditHost
  readonly service: WorkspaceEditService
}) {
  return (
    <WorkspaceEditServiceContext value={service}>
      <WorkspaceTextChangesContext value={service}>
        <WorkspaceEditHostContext value={host}>{children}</WorkspaceEditHostContext>
      </WorkspaceTextChangesContext>
    </WorkspaceEditServiceContext>
  )
}
