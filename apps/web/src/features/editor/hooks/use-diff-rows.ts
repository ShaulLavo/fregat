import {
  joinRenderLines,
  type DiffFile,
  type DiffGutterSide,
  type DiffPlugin,
  type DiffRenderRow,
} from '@singapore-editor/diff'
import { useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useState } from 'react'
import {
  claimPreparedDiffSyntax,
  storePreparedDiffSyntax,
  viewDiffSyntax,
} from '@/features/editor/state/prepared-diff-syntax'

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
 * With a `syntaxSource`, the file takes syntax prepared on intent or kept from an earlier view,
 * and hands its own parse back when the pane leaves it, so a revisit paints coloured at once.
 */
export function useDiffRows(
  plugin: DiffPlugin,
  file: DiffFile | null,
  side: DiffGutterSide,
  syntaxSource: string | null,
): DiffRowsState {
  const [rows, setRows] = useState<readonly DiffRenderRow[]>(() => plugin.getRows())
  const [tokensRevision, setTokensRevision] = useState(0)
  const queryClient = useQueryClient()

  useLayoutEffect(() => {
    if (!file || syntaxSource === null) {
      plugin.setFile(file)
      return
    }
    let current = true
    const claim = claimPreparedDiffSyntax(queryClient, file, side, syntaxSource, () => current)
    plugin.setFile(file, claim)
    const leave = viewDiffSyntax(file, syntaxSource)
    return () => {
      current = false
      leave()
      storePreparedDiffSyntax(file, syntaxSource, plugin.releasePreparedSyntax())
    }
  }, [file, plugin, queryClient, side, syntaxSource])

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
