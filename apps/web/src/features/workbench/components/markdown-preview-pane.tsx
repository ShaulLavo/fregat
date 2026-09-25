import type { EditorTextBuffer } from '@singapore-editor/core/document'
import { useQueryClient } from '@tanstack/react-query'
import {
  Markdown,
  type MarkdownComponents,
  type MarkdownProps,
} from '@workspace/markdown/components/markdown'
import { CodeHighlighterContext } from '@workspace/markdown/providers/code-highlighter-context'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { MarkdownPreviewBlock } from '@/features/workbench/components/markdown-preview-block'
import { MarkdownPreviewCodeBlock } from '@/features/workbench/components/markdown-preview-code-block'
import { MarkdownPreviewImage } from '@/features/workbench/components/markdown-preview-image'
import { MarkdownPreviewLink } from '@/features/workbench/components/markdown-preview-link'
import { MarkdownPreviewContext } from '@/features/workbench/providers/markdown-preview-context'
import type { MarkdownScrollSync } from '@/features/workbench/state/markdown-scroll-sync'
import { remarkPreviewImages } from '@/features/workbench/utils/markdown-preview-images'
import {
  lineForRenderedTop,
  renderedTopForLine,
  sourceAnchors,
} from '@/features/workbench/utils/markdown-scroll-positions'
import { serverEndpoint } from '@/lib/client'
import { useCodeHighlighter } from '@/lib/code-highlight/hooks/use-code-highlighter'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { originForQueryClient } from '@/lib/environments/state/query-clients'

const PREVIEW_COMPONENTS: MarkdownComponents = {
  a: MarkdownPreviewLink,
  img: MarkdownPreviewImage,
  blockquote: MarkdownPreviewBlock,
  h1: MarkdownPreviewBlock,
  h2: MarkdownPreviewBlock,
  h3: MarkdownPreviewBlock,
  h4: MarkdownPreviewBlock,
  h5: MarkdownPreviewBlock,
  h6: MarkdownPreviewBlock,
  hr: MarkdownPreviewBlock,
  li: MarkdownPreviewBlock,
  ol: MarkdownPreviewBlock,
  p: MarkdownPreviewBlock,
  table: MarkdownPreviewBlock,
  ul: MarkdownPreviewBlock,
}

/**
 * The rendered side of the markdown split view: the file as the chat renderer draws it, fences
 * in the editor's theme, scrolled in step with the source beside it.
 */
export function MarkdownPreviewPane({
  buffer,
  documentPath,
  rootPath,
  sync,
}: {
  readonly buffer: EditorTextBuffer
  readonly documentPath: string
  readonly rootPath: string
  readonly sync: MarkdownScrollSync
}) {
  // Manual memo: useSyncExternalStore resubscribes whenever `subscribe` changes identity.
  const subscribe = useCallback((listener: () => void) => buffer.subscribe(listener), [buffer])
  const revision = useSyncExternalStore(subscribe, () => buffer.getRevision())
  const deferredRevision = useDeferredValue(revision)
  // Manual memo: the buffer mutates in place, so its revision is what says the text changed.
  const text = useMemo(() => buffer.materializeFullText(), [buffer, deferredRevision])
  const highlighter = useCodeHighlighter()
  const origin = serverEndpoint(originForQueryClient(useQueryClient()))
  const commands = useEditorCommands()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const quietUntil = useRef(0)
  // Manual memo: the plugin list is the parser's identity; a new list rebuilds the parser.
  const remarkPlugins: MarkdownProps['remarkPlugins'] = useMemo(
    () => [[remarkPreviewImages, { documentPath, origin, rootPath }]],
    [documentPath, origin, rootPath],
  )
  const preview = {
    documentPath,
    rootPath,
    openFile: (path: string) => void commands.openFileSurface(filesystemPath(path)),
  }

  useEffect(
    () =>
      sync.subscribe((line) => {
        const container = scrollRef.current
        if (!container) return
        quietUntil.current = performance.now() + 150
        container.scrollTop = renderedTopForLine(sourceAnchors(container), line + 1)
      }),
    [sync],
  )

  function followSource() {
    const container = scrollRef.current
    if (!container || performance.now() < quietUntil.current) return
    const anchors = sourceAnchors(container)
    if (anchors.length === 0) return
    sync.revealLine(lineForRenderedTop(anchors, container.scrollTop) - 1)
  }

  return (
    <section
      aria-label='Markdown preview'
      className='bg-background flex h-full min-h-0 min-w-0 flex-col overflow-hidden'
      data-markdown-preview=''
    >
      <PaneBar>
        <span className='text-xs font-medium'>Preview</span>
      </PaneBar>
      <div
        className='app-scrollbar-thin min-h-0 flex-1 overflow-auto px-6 py-4 text-sm leading-6'
        ref={scrollRef}
        onScroll={followSource}
      >
        <MarkdownPreviewContext value={preview}>
          <CodeHighlighterContext value={highlighter}>
            <Markdown
              codeBlock={MarkdownPreviewCodeBlock}
              components={PREVIEW_COMPONENTS}
              remarkPlugins={remarkPlugins}
              text={text}
            />
          </CodeHighlighterContext>
        </MarkdownPreviewContext>
      </div>
    </section>
  )
}
