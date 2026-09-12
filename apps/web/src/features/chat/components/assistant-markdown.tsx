import { useEditorColorTheme } from '@/features/editor/hooks/use-editor-color-theme'
import { cjk } from '@streamdown/cjk'
import type { ThemeInput } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { cn } from '@workspace/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { serverEndpoint } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { remarkWorkspaceImages } from '@/features/chat/utils/markdown-images'
import { AssistantMarkdownImage } from '@/features/chat/components/assistant-markdown-image'
import { useMemo, type ClipboardEvent, type ComponentProps } from 'react'
import { defaultRemarkPlugins, Streamdown, type Components } from 'streamdown'

import { useOpenFileReference } from '../hooks/use-open-file-reference'
import { normalizeAgentMarkdown } from '@/features/chat/utils/agent-markdown'
import { chatMarkdownClipboardPayload } from '@/features/chat/utils/markdown-clipboard'
import { remarkFileLinkChips } from '@/features/chat/utils/markdown-file-link-chips'
import { remarkNormalizeListItemIndentation } from '@/features/chat/utils/markdown-list-indentation'
import {
  createStreamdownEditorCodePlugin,
  streamdownEditorThemeKey,
  streamdownThemesForEditorTheme,
} from '@/features/chat/utils/streamdown-editor-theme'
import { MarkdownCodeHighlighterContext } from '../providers/markdown-code-highlighter-context'
import { MarkdownFileLinkContext } from '../providers/markdown-file-link-context'
import { AssistantMarkdownCodeBlock } from './assistant-markdown-code-block'
import { AssistantMarkdownInlineCode } from './assistant-markdown-inline-code'
import { AssistantMarkdownLink } from './assistant-markdown-link'
import { AssistantMarkdownStrong } from './assistant-markdown-strong'

const markdownComponents = {
  a: AssistantMarkdownLink,
  img: AssistantMarkdownImage,
  inlineCode: AssistantMarkdownInlineCode,
  strong: AssistantMarkdownStrong,
} as unknown as Components
type StreamdownProps = ComponentProps<typeof Streamdown>

/**
 * `remarkPlugins` replaces Streamdown's defaults rather than extending them, so
 * ours are appended to the stock set. Dropping it costs GFM (tables, task
 * lists, strikethrough) and the fence metastring the code header titles itself
 * from.
 */
const STREAMDOWN_REMARK_PLUGINS = Object.values(defaultRemarkPlugins)

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
  const { openFileReference, rootPath } = useOpenFileReference()
  const owner = originForQueryClient(useQueryClient())
  const environment = useEnvironmentsStore((state) => state.entries[owner])
  const origin = serverEndpoint(environment?.origin ?? owner)
  const streamdownThemes = useMemo(
    () =>
      streamdownThemesForEditorTheme(
        editorTheme,
        colorMode,
        (registration ?? undefined) as ThemeInput | undefined,
      ),
    [colorMode, editorTheme, registration],
  )
  const codePlugin = useMemo(
    () => createStreamdownEditorCodePlugin(streamdownThemes, editorTheme),
    [editorTheme, streamdownThemes],
  )
  const streamdownPlugins = useMemo(
    () => ({
      cjk,
      code: codePlugin,
      math,
      mermaid,
      // Mermaid stays on Streamdown's diagram path; every other grammar renders
      // through the chat's own cached, streaming-aware code block.
      renderers: [
        {
          component: AssistantMarkdownCodeBlock,
          language: codePlugin.getSupportedLanguages().filter((language) => language !== 'mermaid'),
        },
      ],
    }),
    [codePlugin],
  )
  const themeKey = streamdownEditorThemeKey(editorTheme, colorMode, definition?.shikiName)
  const highlighter = useMemo(
    () =>
      registration
        ? {
            highlight: (
              input: { readonly code: string; readonly language: string },
              onResult: Parameters<typeof codePlugin.highlight>[1],
            ) =>
              codePlugin.highlight(
                {
                  code: input.code,
                  language: input.language as Parameters<
                    typeof codePlugin.highlight
                  >[0]['language'],
                  themes: streamdownThemes,
                },
                onResult,
              ),
            themeKey,
          }
        : null,
    [codePlugin, registration, streamdownThemes, themeKey],
  )
  const fileLinkActions = useMemo(
    () => ({ openFileReference, rootPath }),
    [openFileReference, rootPath],
  )
  const remarkPlugins = useMemo(
    () => [
      ...STREAMDOWN_REMARK_PLUGINS,
      remarkNormalizeListItemIndentation,
      remarkFileLinkChips(rootPath),
      remarkWorkspaceImages(rootPath, origin),
    ],
    [rootPath, origin],
  )
  const renderedText = useMemo(() => normalizeAgentMarkdown(text), [text])

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
        <MarkdownCodeHighlighterContext value={highlighter}>
          <Streamdown
            animated={streaming}
            caret={streaming ? 'block' : undefined}
            className={cn(
              'max-w-full min-w-0 break-words whitespace-pre-wrap [&_[data-streamdown=code-block-body]]:!border-0 [&_[data-streamdown=code-block]]:max-w-full [&_[data-streamdown=code-block]]:!border-0 [&_[data-streamdown=code-block]]:!bg-transparent [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
              className,
            )}
            components={markdownComponents}
            isAnimating={streaming}
            mode='streaming'
            plugins={streamdownPlugins as unknown as StreamdownProps['plugins']}
            remarkPlugins={remarkPlugins}
            shikiTheme={streamdownThemes as unknown as StreamdownProps['shikiTheme']}
          >
            {renderedText}
          </Streamdown>
        </MarkdownCodeHighlighterContext>
      </MarkdownFileLinkContext>
    </div>
  )
}
