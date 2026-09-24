import { useUnicodeHighlights } from '@/features/editor/hooks/use-unicode-highlights'
import type { TabId } from '@/lib/documents/utils/types'
import type { EditorTheme } from '@singapore-editor/core/rendering'
import {
  createDiffPlugin,
  type DiffFile,
  type DiffGutterSide,
  type DiffRegionStore,
  type DiffSyntaxBackend,
} from '@singapore-editor/diff'
import { EditorHost, useEditor } from '@singapore-editor/react'
import type { Editor } from '@singapore-editor/core/editor'
import { useLayoutEffect, useMemo, useRef } from 'react'

import { useDiffLanguage } from '@/features/editor/hooks/use-diff-language'
import { useDiffRows } from '@/features/editor/hooks/use-diff-rows'
import type { DiffLanguageServerContext } from '@/features/editor/utils/diff-language-context'
import {
  DIFF_CURSOR_LINE_HIGHLIGHT,
  DIFF_KEYMAP,
  DIFF_TAB_SIZE,
} from '@/features/editor/utils/diff-options'
import {
  createDiffScrollBridgePlugin,
  type DiffScrollPosition,
} from '@/features/editor/utils/diff-scroll-bridge'
import { log } from '@/lib/client-logging'
import { useEditorFocusTarget } from '@/lib/focus/hooks/use-editor-target'
import { createDiffPresentationBinding } from '@/features/editor/state/diff-presentation'
import type { DiffPanePresentation } from '@/features/editor/state/tab-presentation'

/**
 * One side of a diff: a real read-only `Editor` holding a synthetic buffer of the projected rows,
 * with the diff plugin supplying the rows, the gutter and the expansion clicks.
 */
export function DiffPane({
  file,
  languageServer = null,
  presentation,
  regions,
  side,
  syntaxBackend,
  syntaxHighlight = true,
  tabId,
  theme,
  onFocus,
  onRegisterEditor,
  onScroll,
}: {
  file: DiffFile | null
  /** Present only where a language server may safely be asked about this diff; see `useDiffLanguage`. */
  languageServer?: DiffLanguageServerContext | null
  presentation?: DiffPanePresentation
  regions: DiffRegionStore
  side: DiffGutterSide
  syntaxBackend: DiffSyntaxBackend
  syntaxHighlight?: boolean
  tabId?: TabId
  theme: EditorTheme
  onFocus?: (side: DiffGutterSide) => void
  onRegisterEditor?: (side: DiffGutterSide, editor: Editor | null) => void
  onScroll?: (side: DiffGutterSide, position: DiffScrollPosition) => void
}) {
  // Manual memo: `plugin` is a useLayoutEffect dependency, and the compiler's cache is a
  // cache, not an identity guarantee — when it recomputes, the useLayoutEffect re-runs.
  const plugin = useMemo(
    () =>
      createDiffPlugin({
        mode: 'document',
        regions,
        side,
        syntaxBackend,
        syntaxHighlight,
      }),
    [regions, side, syntaxBackend, syntaxHighlight],
  )
  const { rows, text, tokensRevision } = useDiffRows(plugin, file)
  const diffLanguagePlugin = useDiffLanguage(file, rows, theme, languageServer)
  const unicodeHighlights = useUnicodeHighlights()
  // A plugin instance owns its registered view context for the lifetime of this pane.
  // Manual, because the layout effect below depends on it and the compiler's cache is a cache,
  // not an identity guarantee: a recompute would re-register the context.
  const persistence = useMemo(
    () => (presentation ? createDiffPresentationBinding(presentation) : null),
    [presentation],
  )
  const plugins = [
    plugin,
    unicodeHighlights.plugin,
    onScroll ? createDiffScrollBridgePlugin((position) => onScroll(side, position)) : null,
    diffLanguagePlugin,
    persistence?.plugin,
  ].filter((entry) => entry !== null && entry !== undefined)
  const controller = useEditor({
    presentationReady: false,
    suspiciousCharacters: unicodeHighlights.options,
    cursorLineHighlight: DIFF_CURSOR_LINE_HIGHLIGHT,
    // No `document`: the React wrapper pushes text through `openDocument`, which takes no scroll
    // position from us and therefore lands back at the top — so every expansion toggle, and every
    // keystroke behind a compare-saved diff, would throw the reader's place away. `setText` is the
    // one that carries the scroll position across, and it is what the package's own contract names.
    documentMode: 'static',
    editability: 'readonly',
    keymap: DIFF_KEYMAP,
    // Only the diff plugin: the critical core set would bring line and fold gutters, find, merge
    // conflicts, shiki and LSP, none of which a diff had — and a fold gutter would break the
    // row-index identity the comment layer reads line numbers off.
    plugins,
    storeSync: 'none',
    tabSize: DIFF_TAB_SIZE,
    theme,
    // `selectionSyncMode` is deliberately left at its default. The search-result editor sets
    // `'none'`, which short-circuits before `domSelection.addRange` and leaves copy depending
    // entirely on the hidden textarea; copying a diff selection is the point here.
  })
  useLayoutEffect(() => () => persistence?.detach(), [persistence])
  const focusTarget = useEditorFocusTarget({
    controller,
    writable: false,
    id: {
      key: file?.path ?? '',
      kind: 'editor',
      side,
      surface: 'diff',
      tabId,
    },
  })

  const installedProjection = useRef<{ editor: Editor; text: string } | null>(null)

  // The plugin re-projects its cached per-side token streams synchronously on a toggle, so the
  // tokens read here already match the rows just pushed and paint with them.
  useLayoutEffect(() => {
    const editor = controller.getEditor()
    if (!editor) return

    if (!file || rows !== plugin.getRows()) return
    persistence?.detach()
    editor.setPresentationReady(false)
    const tokens = plugin.getTokens()
    if (
      installedProjection.current?.editor !== editor ||
      installedProjection.current.text !== text
    ) {
      editor.setText(text, { documentMode: 'static', languageId: null, tokens })
      installedProjection.current = { editor, text }
    } else {
      editor.setTokens(tokens)
    }
    persistence?.restore(editor)
    editor.setPresentationReady(plugin.isSyntaxReady())
  }, [controller, file, persistence, plugin, rows, text])

  // A parse landing later changes the tokens without changing a row.
  useLayoutEffect(() => {
    const tokens = plugin.getTokens()
    const editor = controller.getEditor()
    editor?.setTokens(tokens)
    if (file && rows === plugin.getRows()) editor?.setPresentationReady(plugin.isSyntaxReady())
    log.debug({
      action: 'editor.diff.syntax',
      area: 'editor',
      path: file?.path,
      languageId: file?.languageId,
      side,
      backend: syntaxBackend.kind,
      enabled: syntaxHighlight,
      tokenCount: tokens.length,
      oldLineCount: file?.oldLines.length,
      newLineCount: file?.newLines.length,
      partial: file?.isPartial,
    })
  }, [controller, file, plugin, rows, side, syntaxBackend, syntaxHighlight, tokensRevision])

  useLayoutEffect(() => {
    if (!onRegisterEditor) return

    onRegisterEditor(side, controller.getEditor())
    return () => onRegisterEditor(side, null)
  }, [controller, onRegisterEditor, side])

  return (
    <div
      className={`editor-diff-pane editor-diff-pane-${side} flex h-full min-h-0 w-full min-w-0 overflow-hidden`}
      ref={file ? focusTarget.ref : undefined}
      onFocusCapture={onFocus ? () => onFocus(side) : undefined}
    >
      <EditorHost
        className='flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden'
        controller={controller}
      />
    </div>
  )
}
