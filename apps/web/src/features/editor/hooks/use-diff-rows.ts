import {
  joinRenderLines,
  type DiffFile,
  type DiffGutterSide,
  type DiffPlugin,
  type DiffRenderRow,
} from '@singapore-editor/diff'
import type { HighlightingThemeSource } from '@singapore-editor/highlighting'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { highlightingService } from '@/lib/highlighting/state/service'

export type DiffRowsState = {
  readonly rows: readonly DiffRenderRow[]
  readonly syntaxReady: boolean
  readonly text: string
  readonly tokensRevision: number
  readonly appliedFile: RefObject<DiffFile | null>
}

export function useDiffRows(
  plugin: DiffPlugin,
  file: DiffFile | null,
  side: DiffGutterSide,
  syntaxTheme: HighlightingThemeSource | null,
): DiffRowsState {
  const [rows, setRows] = useState<readonly DiffRenderRow[]>(() => plugin.getRows())
  const [tokensRevision, setTokensRevision] = useState(0)
  const [syntaxReady, setSyntaxReady] = useState(() => plugin.isSyntaxReady())
  const appliedFile = useRef<DiffFile | null>(null)
  useLayoutEffect(() => {
    const shown = applyFile(plugin, file, side, syntaxTheme)
    appliedFile.current = file
    return () => shown?.dispose()
  }, [file, plugin, side, syntaxTheme])

  useLayoutEffect(() => {
    const pull = () => {
      setRows(plugin.getRows())
      setSyntaxReady(plugin.isSyntaxReady())
    }
    const pullTokens = () => {
      setTokensRevision((revision) => revision + 1)
      setSyntaxReady(plugin.isSyntaxReady())
    }
    pull()
    const rowsSubscription = plugin.onDidChangeRows(pull)
    const tokensSubscription = plugin.onDidChangeTokens(pullTokens)
    return () => {
      rowsSubscription.dispose()
      tokensSubscription.dispose()
    }
  }, [plugin])

  return { rows, syntaxReady, text: joinRenderLines(rows), tokensRevision, appliedFile }
}

function applyFile(
  plugin: DiffPlugin,
  file: DiffFile | null,
  side: DiffGutterSide,
  syntaxTheme: HighlightingThemeSource | null,
) {
  const shown =
    file && syntaxTheme ? highlightingService().showDiff(plugin, file, side, syntaxTheme) : null
  if (!shown) plugin.setFile(file)
  return shown
}
