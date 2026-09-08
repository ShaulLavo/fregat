import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorktreeId } from '@workspace/contracts'
import type { SettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import { LoadingState } from '@/components/loading-state'
import { TerminalSessions } from '@/terminal/components/sessions'
import type { Theme } from '@/theme/utils/theme'

export function TerminalPane({
  session,
  rootPath,
  theme,
  enabled,
}: {
  readonly session: SettingsSession
  readonly rootPath: string
  readonly theme: Theme
  readonly enabled: boolean
}) {
  const ready = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [state, setState] = useState<
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly rootPath: string; readonly worktreeId: WorktreeId }
    | { readonly kind: 'failed'; readonly message: string }
  >({ kind: 'loading' })
  useEffect(() => {
    let cancelled = false
    void session
      .ensureWorktree(rootPath)
      .then((worktreeId) => {
        if (!cancelled) setState({ kind: 'ready', rootPath, worktreeId })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const failure = connectionFailure(error)
        session.record({
          area: 'terminal',
          operation: 'open-worktree',
          rootPath,
          outcome: 'failed',
          code: failure.code,
          message: failure.message,
        })
        setState({ kind: 'failed', message: failure.message })
      })
    return () => {
      cancelled = true
    }
  }, [session, rootPath])
  if (state.kind === 'failed') return <text fg={theme.destructive}>{state.message}</text>
  if (state.kind !== 'ready' || state.rootPath !== rootPath || ready.kind !== 'ready')
    return <LoadingState theme={theme} label='Opening terminal…' />
  return (
    <TerminalSessions
      key={rootPath}
      session={session}
      rootPath={rootPath}
      worktreeId={state.worktreeId}
      ready={ready}
      theme={theme}
      enabled={enabled}
    />
  )
}
