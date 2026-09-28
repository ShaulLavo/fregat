import { useCallback } from 'react'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { markdownPreviewTarget } from '@/lib/markdown-mode/utils/paths'

export function useMarkdownLinkOpener(documentPath: string, rootPath: string) {
  const commands = useEditorCommands()
  // Plugin registration depends on this callback's identity.
  return useCallback(
    (href: string) => {
      const target = markdownPreviewTarget(href, documentPath, rootPath)
      if (target.kind === 'file') {
        void commands.openFileSurface(filesystemPath(target.path))
        return
      }
      if (target.kind === 'external') window.open(target.href, '_blank', 'noopener,noreferrer')
    },
    [commands, documentPath, rootPath],
  )
}
