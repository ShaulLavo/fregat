import { useQueryClient } from '@tanstack/react-query'
import { use, useMemo, type ReactNode } from 'react'

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
  // Manual memo: every diagnostic surface's mutation reads this from context; a recompute
  // would re-render all of them.
  const requestFix = useMemo(
    () => (attach ? createDiagnosticFix({ attach, documents, queryClient, workspace }) : null),
    [attach, documents, queryClient, workspace],
  )

  return <DiagnosticFixContext value={requestFix}>{children}</DiagnosticFixContext>
}
