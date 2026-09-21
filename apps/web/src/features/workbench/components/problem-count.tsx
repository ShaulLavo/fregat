import { TickerNumber } from '@/components/ticker-number'
import { useSyncExternalStore } from 'react'

import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { useEditorUiState } from '@/features/editor/state/ui-state'

const idleLanguageServerStatusSource = createEditorLanguageServerStatusSource()

export function ProblemCount() {
  const source = useEditorUiState(
    (state) => state.statusBarSource?.languageServerStatusSource ?? idleLanguageServerStatusSource,
  )
  const count = useSyncExternalStore(
    source.subscribe,
    () => source.getSnapshot().diagnostics?.counts.total ?? 0,
  )

  return (
    <span className='bg-muted text-muted-foreground text-3xs flex h-4 min-w-4 items-center justify-center rounded-full px-1 tabular-nums'>
      <TickerNumber size='3xs' value={count} />
    </span>
  )
}
