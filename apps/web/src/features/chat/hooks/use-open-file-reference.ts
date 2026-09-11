import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import type { MarkdownFileReference } from '@/features/chat/utils/markdown-file-links'
import { log } from '@/lib/client-logging'

/**
 * Opening a transcript file reference is an editor command, not a chat concern:
 * the hook owns the whole action so no callback has to travel through the
 * timeline's render tree.
 */
export function useOpenFileReference() {
  const { openDefinition, openFileSurface } = useEditorCommands()
  const rootPath = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)

  function openFileReference(reference: MarkdownFileReference) {
    log.info({
      action: 'chat.markdown.open_file_reference',
      area: 'chat',
      column: reference.column,
      line: reference.line,
      path: reference.path,
      rootPath,
    })

    if (reference.line === null) {
      openFileSurface(reference.path)
      return
    }

    openDefinition(fileReferenceDefinitionTarget(reference))
  }

  return { openFileReference, rootPath }
}

/** Editor positions are zero-based; transcript references are one-based. */
function fileReferenceDefinitionTarget(reference: MarkdownFileReference) {
  const line = Math.max(0, (reference.line ?? 1) - 1)
  const character = Math.max(0, (reference.column ?? 1) - 1)

  return {
    path: reference.path,
    range: {
      end: { character: character + 1, line },
      start: { character, line },
    },
    uri: `file://${reference.path.split('/').map(encodeURIComponent).join('/')}`,
  }
}
