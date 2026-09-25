import { HOSTED_EDITOR_KEYMAP } from '@/keymap/editor-keymap'
import type { EditorTheme } from '@singapore-editor/core/rendering'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { EditorHost, useEditor } from '@singapore-editor/react'
import {
  memo,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import { editorTreeSitterSyntaxProvider } from '@/features/editor/state/syntax-highlighting'
import { createPlatformSearchResultEditorLoggingPlugin } from '@/features/editor/utils/plugins'
import { useSearchResultActions } from '@/features/search/hooks/use-result-actions'
import { SearchResultFileLineActions } from '@/features/search/components/result-file-line-actions'
import { SearchResultSourceLineGutter } from '@/features/search/components/result-source-line-gutter'
import { createSearchResultSyntaxHighlightingPlugin } from '@/features/search/utils/result-syntax-plugin'
import {
  EXCERPT_EDITOR_FONT_SIZE,
  EXCERPT_EDITOR_LINE_HEIGHT,
  SEARCH_RESULT_CURSOR_LINE_HIGHLIGHT,
  SEARCH_RESULT_FILE_EDITOR_ROW_GAP,
  SEARCH_RESULT_FILE_EDITOR_TEXT_METRICS,
} from '@/features/search/utils/result-editor-constants'
import {
  currentSearchResultFileLine,
  fileBlockLineDigits,
  isSearchResultEditorActionTarget,
  openFileResultOnEnter,
  preventReadonlyInput,
  readonlyEditingKey,
  searchResultFileDocumentId,
  searchResultFileDocumentRevision,
  searchResultFileDocumentWindow,
  searchResultFileEditorScrollMode,
  searchResultFileEditorStyle,
  searchResultFileLineIdAtClientY,
  searchResultFileRangeDecorations,
  type SearchResultFileEditorLineWindow,
} from '@/features/search/utils/result-editor'
import type { SearchResultId } from '@/features/search/utils/result-items'
import {
  searchResultFileDocument,
  type SearchResultFileBlock,
  type SearchResultFileDocumentLine,
} from '@/features/search/utils/result-view-model'
import { useEditorFocusTarget } from '@/lib/focus/hooks/use-editor-target'
import { useSettingValue } from '@/hooks/use-setting-value'
import { fontStack } from '@/lib/default-nerd-font'

type SearchResultFileEditorProps = {
  activeResultId: SearchResultId | null
  canReplace?: boolean
  editorTheme: EditorTheme
  file: SearchResultFileBlock

  lineWindow: SearchResultFileEditorLineWindow
  replaceVisible: boolean
}

export const SearchResultFileEditor = memo(
  ({
    activeResultId,
    canReplace,
    editorTheme,
    file,

    lineWindow,
    replaceVisible,
  }: SearchResultFileEditorProps) => {
    const { openTarget, replaceMatch, selectResultWithoutReveal } = useSearchResultActions()
    // Manual memo: `fileDocument` is a useMemo dependency, and the compiler's cache is a
    // cache, not an identity guarantee — when it recomputes, the useMemo re-runs.
    const fileDocument = useMemo(() => searchResultFileDocument(file), [file])
    // Manual keys: the compiler would also key this on `activeResultId`, so moving the selection
    // would rebuild the windowed document under the editor.
    const visibleDocument = useMemo(
      () => searchResultFileDocumentWindow(fileDocument, lineWindow),
      [fileDocument, lineWindow],
    )
    const sourceLineDigits = fileBlockLineDigits(file)
    const fontFamily = fontStack(useSettingValue('editor.fontFamily'))
    const tabSize = useSettingValue('editor.tabSize')
    const document = {
      documentId: searchResultFileDocumentId(file),
      documentMode: 'static' as const,
      languageId: visibleDocument.languageId,
      revision: searchResultFileDocumentRevision(visibleDocument, lineWindow),
      text: visibleDocument.text,
      textSyncMode: 'open' as const,
    }
    const rangeDecorations = searchResultFileRangeDecorations(visibleDocument, activeResultId)
    const syntaxPlugins = [
      createSearchResultSyntaxHighlightingPlugin(editorTreeSitterSyntaxProvider()),
    ]
    const plugins = createFileResultEditorPlugins(syntaxPlugins)
    const editorStyle = searchResultFileEditorStyle(visibleDocument)
    const editorScrollMode = searchResultFileEditorScrollMode(visibleDocument.lines.length)
    const controller = useEditor({
      cursorLineHighlight: SEARCH_RESULT_CURSOR_LINE_HIGHLIGHT,
      document,
      editability: 'readonly',
      fontFamily,
      fontSize: EXCERPT_EDITOR_FONT_SIZE,
      keymap: HOSTED_EDITOR_KEYMAP,
      lineHeight: EXCERPT_EDITOR_LINE_HEIGHT,
      plugins,
      rangeDecorations,
      rowGap: SEARCH_RESULT_FILE_EDITOR_ROW_GAP,
      scrollMode: editorScrollMode,
      selectionSyncMode: 'none',
      storeSync: 'none',
      tabSize,
      textMetrics: SEARCH_RESULT_FILE_EDITOR_TEXT_METRICS,
      theme: editorTheme,
    })
    const { ref: focusTargetRef } = useEditorFocusTarget({
      controller,
      writable: false,
      id: {
        key: document.documentId,
        kind: 'editor',
        surface: 'search-result',
      },
    })
    const editorHostRef = useRef<HTMLDivElement | null>(null)
    const pendingActivationFrameRef = useRef<number | null>(null)
    const lineActionRowsRef = useRef(new Map<SearchResultId, HTMLDivElement>())
    const hoveredLineActionRowRef = useRef<HTMLDivElement | null>(null)
    const setHoveredLineActionRow = (lineId: SearchResultId | null) => {
      const nextRow = lineId ? (lineActionRowsRef.current.get(lineId) ?? null) : null
      if (hoveredLineActionRowRef.current === nextRow) return

      hoveredLineActionRowRef.current?.removeAttribute('data-hovered')
      hoveredLineActionRowRef.current = nextRow
      nextRow?.setAttribute('data-hovered', 'true')
    }

    useEffect(
      () => () => {
        if (pendingActivationFrameRef.current === null) return

        window.cancelAnimationFrame(pendingActivationFrameRef.current)
      },
      [],
    )

    const clearHoveredLineAction = useEffectEvent(() => {
      setHoveredLineActionRow(null)
    })
    useEffect(() => () => clearHoveredLineAction(), [])

    const lineIdAtClientY = (clientY: number) =>
      searchResultFileLineIdAtClientY(
        visibleDocument,
        controller.getEditor(),
        editorHostRef.current,
        clientY,
      )

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
      if (isSearchResultEditorActionTarget(event.target)) return

      const nextResultId = lineIdAtClientY(event.clientY) ?? file.id
      if (pendingActivationFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingActivationFrameRef.current)
      }
      pendingActivationFrameRef.current = window.requestAnimationFrame(() => {
        pendingActivationFrameRef.current = null
        selectResultWithoutReveal(nextResultId)
      })
    }

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
      setHoveredLineActionRow(lineIdAtClientY(event.clientY))
    }

    const handlePointerLeave = () => {
      setHoveredLineActionRow(null)
    }

    const handleOpen = () => {
      const line = currentSearchResultFileLine(visibleDocument, controller)
      if (!line) return

      openTarget({
        match: line.sourceMatch,
        path: file.path,
      })
    }

    const handleOpenLine = (line: SearchResultFileDocumentLine) => {
      selectResultWithoutReveal(line.id)
      openTarget({
        match: line.sourceMatch,
        path: file.path,
      })
    }

    const handleReplaceLine = (line: SearchResultFileDocumentLine) => {
      selectResultWithoutReveal(line.id)
      replaceMatch(line.sourceMatch)
    }

    const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
      if (openFileResultOnEnter(event, handleOpen)) return
      if (!readonlyEditingKey(event)) return

      event.preventDefault()
      event.stopPropagation()
    }

    return (
      <div
        className='ml-5 min-w-0 border-l border-transparent px-2 py-0.5'
        ref={focusTargetRef}
        onBeforeInputCapture={preventReadonlyInput}
        onDropCapture={preventReadonlyInput}
        onKeyDownCapture={handleKeyDownCapture}
        onPasteCapture={preventReadonlyInput}
        onPointerLeave={handlePointerLeave}
        onPointerMoveCapture={handlePointerMove}
        onPointerUpCapture={handlePointerUp}
      >
        <div
          className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5'
          style={{ transform: `translateY(${lineWindow.offsetY}px)` }}
        >
          <div className='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start'>
            <SearchResultSourceLineGutter document={visibleDocument} minDigits={sourceLineDigits} />
            <div className='min-w-0' ref={editorHostRef}>
              <EditorHost
                className='app-editor-host search-result-file-editor-host'
                controller={controller}
                style={editorStyle}
              />
            </div>
          </div>
          <SearchResultFileLineActions
            canReplace={canReplace}
            document={visibleDocument}
            lineActionRowsRef={lineActionRowsRef}
            replaceVisible={replaceVisible}
            onOpenLine={handleOpenLine}
            onReplaceLine={handleReplaceLine}
          />
        </div>
      </div>
    )
  },
)

function createFileResultEditorPlugins(syntaxPlugins: readonly EditorPlugin[]) {
  return [...syntaxPlugins, createPlatformSearchResultEditorLoggingPlugin()]
}
