import { useQueryClient } from '@tanstack/react-query'
import { use, type ReactNode } from 'react'

import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { ComposerAttachContext } from '@/lib/composer-attach/providers/context'
import { DiagnosticFixContext } from '@/lib/diagnostic-ai/providers/context'
import { createDiagnosticFix } from '@/state/diagnostic-fix'

/**
 * Fix with AI for diagnostics, under ComposerAttachProvider whose chat it opens. Without one
 * (a tree that has no chat) it provides nothing and the diagnostic surfaces offer no action.
 */
export function DiagnosticFixProvider({ children }: { readonly children: ReactNode }) {
  const attach = use(ComposerAttachContext)
  const documents = useEditorDocumentStoreApi()
  const workspace = useEditorWorkspaceStoreApi()
  const queryClient = useQueryClient()
  const requestFix = attach
    ? createDiagnosticFix({ attach, documents, queryClient, workspace })
    : null

  return <DiagnosticFixContext value={requestFix}>{children}</DiagnosticFixContext>
}
