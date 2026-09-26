import { markdownServerFilePath } from '@/features/chat/utils/markdown-workspace-path'
import { use } from 'react'
import { toast } from 'sonner'
import { ChatWorkspaceRootContext } from '@/features/chat/providers/workspace-root-context'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import type { MarkdownFileReference } from '@/features/chat/utils/markdown-file-links'
import { log } from '@/lib/client-logging'
import { fileUriForPath } from '@workspace/contracts'

/**
 * Opening a transcript file reference is an editor command, not a chat concern:
 * the hook owns the whole action so no callback has to travel through the
 * timeline's render tree.
 */
export function useOpenFileReference() {
  const { openDefinition, openFileSurface } = useEditorCommands()
  const chatWorkspace = use(ChatWorkspaceRootContext)
  const editorRoot = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const rootPath = chatWorkspace?.canonicalPath ?? editorRoot
  const workspacePath = chatWorkspace?.path ?? editorRoot

  function openFileReference(source: MarkdownFileReference) {
    const path = markdownServerFilePath(source.path, rootPath, workspacePath)
    log.info({
      action: 'chat.markdown.open_file_reference',
      area: 'chat',
      column: source.column,
      line: source.line,
      opened: path !== null,
      path: path ?? source.path,
      rootPath,
    })
    if (path === null) {
      toast.warning('That file is outside the workspace', { description: source.path })
      return
    }

    const reference = { ...source, path }

    if (reference.line === null) {
      openFileSurface(filesystemPath(reference.path))
      return
    }

    openDefinition(fileReferenceDefinitionTarget(reference))
  }

  return { openFileReference, rootPath, workspacePath }
}

/** Editor positions are zero-based; transcript references are one-based. */
export function fileReferenceDefinitionTarget(reference: MarkdownFileReference) {
  const line = Math.max(0, (reference.line ?? 1) - 1)
  const character = Math.max(0, (reference.column ?? 1) - 1)

  return {
    path: reference.path,
    range: {
      end: { character: character + 1, line },
      start: { character, line },
    },
    uri: fileUriForPath(reference.path),
  }
}
