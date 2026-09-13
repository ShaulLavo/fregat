import {
  joinRenderLines,
  type DiffFile,
  type DiffPlugin,
  type DiffRenderRow,
} from '@singapore-editor/diff'
import { useLayoutEffect, useMemo, useState } from 'react'

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
 */
export function useDiffRows(plugin: DiffPlugin, file: DiffFile | null): DiffRowsState {
  const [rows, setRows] = useState<readonly DiffRenderRow[]>(() => plugin.getRows())
  const [tokensRevision, setTokensRevision] = useState(0)

  useLayoutEffect(() => {
    plugin.setFile(file)
  }, [file, plugin])

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

  const text = useMemo(() => joinRenderLines(rows), [rows])

  return { rows, text, tokensRevision }
}
