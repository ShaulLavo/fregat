import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { SettingsSession } from '@/connection/state/session'
import { createViewerLsp } from '@/viewer/state/lsp'
import { createViewerSyntax, type ViewerTokens } from '@/viewer/state/syntax'
import type { ViewerDiagnostics } from '@/viewer/utils/lsp'
import type { ViewerDocument } from '@/viewer/state/document'

export function useViewerLanguage({
  session,
  rootPath,
  path,
  state,
  appearance,
  onDiagnostics,
}: {
  readonly session: SettingsSession
  readonly rootPath: string
  readonly path: string
  readonly state: ViewerDocument
  readonly appearance: 'dark' | 'light'
  readonly onDiagnostics?: (snapshot: ViewerDiagnostics) => void
}) {
  const [tokens, setTokens] = useState<ViewerTokens>([])
  const lsp = useRef<ReturnType<typeof createViewerLsp> | null>(null)
  const notify = useEffectEvent((snapshot: ViewerDiagnostics) => onDiagnostics?.(snapshot))
  const content = state.kind === 'ready' ? state.file.content : null
  useEffect(() => {
    if (content === null) return
    const owner = createViewerLsp({
      session,
      rootPath,
      filePath: path,
      content,
      onDiagnostics: notify,
    })
    lsp.current = owner
    return () => {
      owner.dispose()
      lsp.current = null
    }
  }, [session, rootPath, path, content])
  useEffect(() => {
    if (content === null) return
    let active = true
    const syntax = createViewerSyntax()
    void syntax
      .tokenize(path, content, appearance)
      .then((result) => {
        if (active) setTokens(result)
      })
      .catch((error) =>
        session.record({
          area: 'tui.viewer.syntax',
          path,
          outcome: 'failed',
          error: String(error),
        }),
      )
    return () => {
      active = false
      syntax.dispose()
    }
  }, [session, path, content, appearance])
  return { tokens, lsp }
}
