import { useUnicodeHighlights } from '@/features/editor/hooks/use-unicode-highlights'
import type { DiffAttachment } from '@/features/editor/utils/diff-attachment'
import { createTabPresentation } from '@/features/editor/state/tab-presentation'
import type { TabId } from '@/lib/documents/utils/types'
import type { EditorTheme } from '@singapore-editor/core/rendering'
import {
  createDiffEditorOptions,
  createDiffPlugin,
  type DiffGutterSide,
  type DiffRegionStore,
  type DiffSyntaxBackend,
} from '@singapore-editor/diff'
import { EditorHost, useEditor } from '@singapore-editor/react'
import type { Editor } from '@singapore-editor/core/editor'
import { useEffectEvent, useLayoutEffect, useMemo, useState } from 'react'

import { useDiffLanguage } from '@/features/editor/hooks/use-diff-language'
import { useDiffRows } from '@/features/editor/hooks/use-diff-rows'
import { useEditorTypography } from '@/features/editor/hooks/use-editor-typography'
import { useEditorGutterInset } from '@/hooks/use-editor-gutter-inset'
import type { DiffLanguageServerContext } from '@/features/editor/utils/diff-language-context'
import { useCommand } from '@/keymap/hooks/use-command'
import { fileExtension } from '@/lib/path-formatters'
import { log } from '@/lib/client-logging'
import { notePressPaint } from '@/lib/intent-prefetch/state/press-paint'
import { useEditorFocusTarget } from '@/lib/focus/hooks/use-editor-target'
import {
  bindDiffPlugin,
  createDiffPresentationBinding,
} from '@/features/editor/state/diff-presentation'
import type { HighlightingThemeSource } from '@singapore-editor/highlighting'
import type {
  DiffPanePresentation,
  DiffScrollPosition,
} from '@/features/editor/state/tab-presentation'
import { diffSyntaxState } from '@/features/editor/utils/diff-syntax-state'

/**
 * One side of a diff: a real read-only `Editor` holding a synthetic buffer of the projected rows,
 * with the diff plugin supplying the rows, the gutter and the expansion clicks.
 */
export function DiffPane({
  attachment,
  languageServer = null,
  presentation: suppliedPresentation,
  regions,
  side,
  syntaxBackend,
  syntaxHighlight = true,
  syntaxTheme = null,
  tabId,
  theme,
  onFocus,
  onRegisterEditor,
  onScroll,
}: {
  attachment: DiffAttachment
  /** Present only where a language server may safely be asked about this diff; see `useDiffLanguage`. */
  languageServer?: DiffLanguageServerContext | null
  presentation?: DiffPanePresentation
  regions: DiffRegionStore
  side: DiffGutterSide
  syntaxBackend: DiffSyntaxBackend
  syntaxHighlight?: boolean
  /** The palette prepared diff syntax is kept under; omit to parse every time. */
  syntaxTheme?: HighlightingThemeSource | null
  tabId?: TabId
  theme: EditorTheme
  onFocus?: (side: DiffGutterSide) => void
  onRegisterEditor?: (side: DiffGutterSide, editor: Editor | null) => void
  onScroll?: (side: DiffGutterSide, position: DiffScrollPosition) => void
}) {
  const file = attachment.file
  const [localPresentation] = useState(() => createTabPresentation().diffPanes[side])
  const presentation = suppliedPresentation ?? localPresentation
  // Diff syntax reads row N's tokens from source line N; a patch holds only the lines git printed.
  const highlight = syntaxHighlight && file?.isPartial !== true
  // Manual memo: `plugin` is a useLayoutEffect dependency, and the compiler's cache is a
  // cache, not an identity guarantee — when it recomputes, the useLayoutEffect re-runs.
  const plugin = useMemo(
    () =>
      createDiffPlugin({
        mode: 'document',
        regions,
        side,
        syntaxBackend,
        syntaxHighlight: highlight,
      }),
    [highlight, regions, side, syntaxBackend],
  )
  useLayoutEffect(() => {
    if (!presentation) return
    return bindDiffPlugin(presentation, plugin)
  }, [plugin, presentation])
  const { rows, syntaxReady, text, tokensRevision, appliedFile } = useDiffRows(
    plugin,
    file,
    side,
    highlight ? syntaxTheme : null,
  )
  const diffLanguagePlugin = useDiffLanguage(file, rows, theme, languageServer)
  const { keymap } = useCommand()
  const unicodeHighlights = useUnicodeHighlights()
  // A plugin instance owns its registered view context for the lifetime of this pane.
  // Manual, because the layout effect below depends on it and the compiler's cache is a cache,
  // not an identity guarantee: a recompute would re-register the context.
  const persistence = useMemo(
    () => (presentation ? createDiffPresentationBinding(presentation, side) : null),
    [presentation, side],
  )
  const plugins = [
    plugin,
    unicodeHighlights.plugin,
    diffLanguagePlugin,
    persistence?.plugin,
  ].filter((entry) => entry !== null && entry !== undefined)
  const typography = useEditorTypography()
  // The new side of a split sits beside the old one, away from the screen edge.
  const gutterInset = useEditorGutterInset()
  const controller = useEditor({
    ...createDiffEditorOptions(),
    keymapContext: { mode: 'diff', extension: file ? fileExtension(file.path) : '' },
    suspiciousCharacters: unicodeHighlights.options,
    ...typography,
    gutterLeadingInset: side === 'new' ? 0 : gutterInset,
    hotkeys: keymap.hotkeys,
    hotkeysParent: keymap.parentFor('editor'),
    // Only the diff plugin: the critical core set would bring line and fold gutters, find, merge
    // conflicts, shiki and LSP, none of which a diff had — and a fold gutter would break the
    // row-index identity the comment layer reads line numbers off.
    plugins,
    storeSync: 'none',
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

  const publishRows = useEffectEvent(() => {
    const editor = controller.getEditor()
    if (!editor || appliedFile.current !== file) return
    persistence?.publish(editor, attachment, plugin.getRows(), plugin.getTokens(), {
      backend: syntaxBackend,
      theme: syntaxTheme,
      enabled: highlight,
    })
    notePressPaint('diffs', file.path, 'text')
  })

  const publishTokens = useEffectEvent(() => {
    const editor = controller.getEditor()
    if (!editor || appliedFile.current !== file) return
    persistence?.publishTokens(editor, attachment, plugin.getRows(), plugin.getTokens(), {
      backend: syntaxBackend,
      theme: syntaxTheme,
      enabled: highlight,
    })
  })

  useLayoutEffect(() => {
    const rowChanges = plugin.onDidChangeRows(publishRows)
    const tokenChanges = plugin.onDidChangeTokens(publishTokens)
    return () => {
      rowChanges.dispose()
      tokenChanges.dispose()
    }
  }, [plugin])

  useLayoutEffect(() => {
    publishRows()
  }, [attachment, controller, persistence, plugin, rows, text])

  useLayoutEffect(() => {
    if (rows !== plugin.getRows()) return
    publishTokens()
    if (!highlight) notePressPaint('diffs', file.path, 'colour', { highlight: 'off' })
    else if (plugin.isSyntaxReady()) notePressPaint('diffs', file.path, 'colour')
    log.debug({
      action: 'editor.diff.syntax',
      area: 'editor',
      path: file.path,
      languageId: file.languageId,
      side,
      backend: syntaxBackend.kind,
      enabled: highlight,
      tokenCount: plugin.getTokens().length,
      oldLineCount: file.oldLines.length,
      newLineCount: file.newLines.length,
      partial: file.isPartial,
    })
  }, [
    attachment,
    controller,
    file,
    highlight,
    persistence,
    plugin,
    rows,
    side,
    syntaxBackend,
    tokensRevision,
  ])

  useLayoutEffect(() => {
    const editor = controller.getEditor()
    if (!editor || !onScroll) return

    const subscription = editor.onDidScroll((position) => onScroll(side, position))
    return () => subscription.dispose()
  }, [controller, onScroll, side])

  useLayoutEffect(() => {
    if (!onRegisterEditor) return

    onRegisterEditor(side, controller.getEditor())
    return () => onRegisterEditor(side, null)
  }, [controller, onRegisterEditor, side])

  return (
    <div
      className={`editor-diff-pane editor-diff-pane-${side} flex h-full min-h-0 w-full min-w-0 overflow-hidden`}
      data-syntax={diffSyntaxState(highlight, syntaxReady)}
      ref={file ? focusTarget.ref : undefined}
      onFocusCapture={onFocus ? () => onFocus(side) : undefined}
    >
      <EditorHost
        className='app-editor-host flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden'
        controller={controller}
      />
    </div>
  )
}
