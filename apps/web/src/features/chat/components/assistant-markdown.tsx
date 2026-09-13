import {
  Markdown,
  type MarkdownComponents,
  type MarkdownProps,
} from '@workspace/markdown/components/markdown'
import { CodeHighlighterContext } from '@workspace/markdown/providers/code-highlighter-context'
import { cn } from '@workspace/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, type ClipboardEvent } from 'react'
import type { ThemeRegistrationAny } from 'shiki/core'

import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { serverEndpoint } from '@/lib/client'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

import { useMermaid } from '../hooks/use-mermaid'
import { useOpenFileReference } from '../hooks/use-open-file-reference'
import { MarkdownDiagramContext } from '../providers/markdown-diagram-context'
import { MarkdownFileLinkContext } from '../providers/markdown-file-link-context'
import { normalizeAgentMarkdown } from '@/features/chat/utils/agent-markdown'
import { codeHighlighterForTheme } from '@/features/chat/state/code-highlighters'
import { editorThemeHighlightKey } from '@/features/chat/utils/code-highlighter-theme'
import { chatMarkdownClipboardPayload } from '@/features/chat/utils/markdown-clipboard'
import { remarkFileLinkChips } from '@/features/chat/utils/markdown-file-link-chips'
import { remarkWorkspaceImages } from '@/features/chat/utils/markdown-images'
import { remarkNormalizeListItemIndentation } from '@/features/chat/utils/markdown-list-indentation'
import { AssistantMarkdownCodeBlock } from './assistant-markdown-code-block'
import { AssistantMarkdownImage } from './assistant-markdown-image'
import { AssistantMarkdownInlineCode } from './assistant-markdown-inline-code'
import { AssistantMarkdownLink } from './assistant-markdown-link'
import { AssistantMarkdownStrong } from './assistant-markdown-strong'

const markdownComponents: MarkdownComponents = {
  a: AssistantMarkdownLink,
  code: AssistantMarkdownInlineCode,
  img: AssistantMarkdownImage,
  strong: AssistantMarkdownStrong,
}

export function AssistantMarkdown({
  className,
  streaming = false,
  text,
}: {
  className?: string
  streaming?: boolean
  text: string
}) {
  const { colorMode, definition, editorTheme, registration } = useEditorColorTheme()
  const { openFileReference, rootPath, workspacePath } = useOpenFileReference()
  const owner = originForQueryClient(useQueryClient())
  const environment = useEnvironmentsStore((state) => state.entries[owner])
  const origin = serverEndpoint(environment?.origin ?? owner)
  const themeKey = editorThemeHighlightKey(editorTheme, colorMode, definition?.shikiName)
  const highlighter = registration
    ? codeHighlighterForTheme({
        colorMode,
        editorTheme,
        registration: registration as ThemeRegistrationAny,
        themeKey,
      })
    : null
  const renderedText = normalizeAgentMarkdown(text)
  const mermaid = useMermaid(renderedText, streaming)
  const fileLinkActions = useMemo(
    () => ({ openFileReference, rootPath }),
    [openFileReference, rootPath],
  )
  // The plugin list is the parser's identity: a new list is a new parser and
  // an empty incremental cache, so it changes only with the workspace.
  const remarkPlugins = useMemo<MarkdownProps['remarkPlugins']>(
    () => [
      remarkNormalizeListItemIndentation,
      [remarkFileLinkChips, { rootPath }],
      [remarkWorkspaceImages, { rootPath, workspacePath, origin }],
    ],
    [rootPath, workspacePath, origin],
  )

  // Re-emit the rendered view as markdown so copying a selection keeps links,
  // emphasis, lists and fences instead of flattening to text.
  function handleCopy(event: ClipboardEvent<HTMLDivElement>) {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    const payload = chatMarkdownClipboardPayload(selection)
    if (!payload) return

    event.preventDefault()
    event.clipboardData.setData('text/plain', payload.text)
    event.clipboardData.setData('text/html', payload.html)
  }

  return (
    <div className='min-w-0' data-chat-markdown='true' onCopy={handleCopy}>
      <MarkdownFileLinkContext value={fileLinkActions}>
        <CodeHighlighterContext value={highlighter}>
          <MarkdownDiagramContext value={mermaid}>
            <Markdown
              caret={streaming}
              className={cn('max-w-full min-w-0 break-words whitespace-pre-wrap', className)}
              codeBlock={AssistantMarkdownCodeBlock}
              components={markdownComponents}
              remarkPlugins={remarkPlugins}
              streaming={streaming}
              text={renderedText}
            />
          </MarkdownDiagramContext>
        </CodeHighlighterContext>
      </MarkdownFileLinkContext>
    </div>
  )
}
