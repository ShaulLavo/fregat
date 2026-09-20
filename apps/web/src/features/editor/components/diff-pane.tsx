import { useUnicodeHighlights } from '@/features/editor/hooks/use-unicode-highlights'
import type { TabId } from '@/lib/documents/utils/types'
import type { EditorTheme } from '@singapore-editor/core'
import {
  createDiffPlugin,
  type DiffFile,
  type DiffGutterSide,
  type DiffRegionStore,
  type DiffSyntaxBackend,
} from '@singapore-editor/diff'
import { EditorHost, useEditor } from '@singapore-editor/react'
import type { Editor } from '@singapore-editor/core'
import { useLayoutEffect, useMemo } from 'react'

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
 *
 * `editor-diff-pane` and its `-${side}` suffix are stamped here rather than by the package. Both
 * are read: the bare class is how the git line-comment layer resolves which pane a row element
 * belongs to, and the suffix is how it names the side. Dropping either breaks side detection even
 * though nothing renders differently.
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
  const persistence = useMemo(
    () => (presentation ? createDiffPresentationBinding(presentation) : null),
    [presentation],
  )
  const plugins = useMemo(
    () =>
      [
        plugin,
        unicodeHighlights.plugin,
        onScroll ? createDiffScrollBridgePlugin((position) => onScroll(side, position)) : null,
        diffLanguagePlugin,
        persistence?.plugin,
      ].filter((entry) => entry !== null && entry !== undefined),
    [diffLanguagePlugin, onScroll, persistence, plugin, side, unicodeHighlights.plugin],
  )
  const controller = useEditor({
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

  // `setText` clears tokens on its way through `setContent`, so they go back on in the same
  // statement pair — an expansion toggle would otherwise repaint uncoloured until the next parse.
  // The plugin re-projects its cached per-side token streams synchronously on a toggle, so what is
  // read here is already correct for the rows just pushed.
  useLayoutEffect(() => {
    const editor = controller.getEditor()
    if (!editor) return

    editor.setText(text, { documentMode: 'static', languageId: null })
    editor.setTokens(plugin.getTokens())
    if (file && rows === plugin.getRows()) persistence?.restore(editor)
  }, [controller, file, persistence, plugin, rows, text])

  // A parse landing later changes the tokens without changing a row.
  useLayoutEffect(() => {
    const tokens = plugin.getTokens()
    controller.getEditor()?.setTokens(tokens)
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
  }, [controller, file, plugin, side, syntaxBackend, syntaxHighlight, tokensRevision])

  useLayoutEffect(() => {
    if (!onRegisterEditor) return

    onRegisterEditor(side, controller.getEditor())
    return () => onRegisterEditor(side, null)
  }, [controller, onRegisterEditor, side])

  // The whole design rests on projection row `i` being buffer row `i` being
  // `data-editor-virtual-row="i"`. The plugin checks the identity on the rows actually mounted;
  // anything that breaks it (word wrap, a fold map, block rows) would otherwise show up as line
  // comments quietly addressing the wrong line.
  useLayoutEffect(() => {
    if (!file) return

    const { lineCount, rowCount, violations } = plugin.getDocumentModeStatus()
    // The plugin can publish its next projection one layout pass before this host receives it.
    if (rowCount !== rows.length) return
    if (violations.length === 0) return

    log.warn({
      action: 'editor.diff.document_mode_violation',
      area: 'editor',
      documentId: `${file.cacheKey ?? file.path}:${side}`,
      lineCount,
      rowCount,
      side,
      violations,
    })
  }, [file, plugin, rows, side])

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
