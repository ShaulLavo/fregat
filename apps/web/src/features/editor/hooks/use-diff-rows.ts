import {
  joinRenderLines,
  type DiffFile,
  type DiffGutterSide,
  type DiffPlugin,
  type DiffRenderRow,
} from '@singapore-editor/diff'
import type { HighlightingThemeSource } from '@singapore-editor/highlighting'
import { useLayoutEffect, useState } from 'react'
import { highlightingService } from '@/lib/highlighting/state/service'

export type DiffRowsState = {
  readonly rows: readonly DiffRenderRow[]
  readonly text: string
  readonly tokensRevision: number
}

/**
 * The plugin owns the diff; the host owns the editor's document. No plugin context can mutate
 * document text, so the split is forced: the plugin publishes rows and this turns them into the
 * buffer text the host pushes in.
 *
 * Layout effects rather than passive ones throughout — a passive `setFile` would paint one frame of
 * an empty editor before the rows arrived. The rows array is the state, not a copy of it: the
 * plugin hands out a stable reference until it rebuilds, so React bails out on its own when a
 * notification changes nothing.
 *
 * With a `syntaxTheme`, the highlighting service shows the file with syntax prepared on intent or
 * kept from an earlier view, and takes the pane's parse back when it leaves, so a revisit paints
 * coloured at once.
 */
export function useDiffRows(
  plugin: DiffPlugin,
  file: DiffFile | null,
  side: DiffGutterSide,
  syntaxTheme: HighlightingThemeSource | null,
): DiffRowsState {
  const [rows, setRows] = useState<readonly DiffRenderRow[]>(() => plugin.getRows())
  const [tokensRevision, setTokensRevision] = useState(0)
  useLayoutEffect(() => {
    if (!file || syntaxTheme === null) {
      plugin.setFile(file)
      return
    }
    const shown = highlightingService().showDiff(plugin, file, side, syntaxTheme)
    return () => shown.dispose()
  }, [file, plugin, side, syntaxTheme])

  useLayoutEffect(() => {
    const pull = () => setRows(plugin.getRows())

    // The file is pushed by the effect above, which runs first and notifies nobody yet.
    pull()
    const rowsSubscription = plugin.onDidChangeRows(pull)
    const tokensSubscription = plugin.onDidChangeTokens(() =>
      setTokensRevision((revision) => revision + 1),
    )

    return () => {
      rowsSubscription.dispose()
      tokensSubscription.dispose()
    }
  }, [plugin])

  const text = joinRenderLines(rows)

  return { rows, text, tokensRevision }
}
