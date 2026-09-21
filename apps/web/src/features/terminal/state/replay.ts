import type { Terminal, TerminalScrollbar } from 'ghostty-webgpu'

export function createReplayGate({
  terminal,
  getSavedScroll,
  onReady,
}: {
  terminal: Pick<Terminal, 'scrollBy' | 'refresh'> & {
    readonly appearance: { readonly grid: { readonly rows: number } }
  }
  getSavedScroll: () => Readonly<TerminalScrollbar> | null
  onReady: (ready: boolean) => void
}) {
  let phase: 'replaying' | 'awaiting-paint' | 'ready' | 'closed' = 'replaying'
  let restoreScroll = true
  return {
    begin() {
      if (phase === 'closed') return
      phase = 'replaying'
      onReady(false)
    },
    complete() {
      if (phase !== 'replaying') return
      const saved = restoreScroll ? getSavedScroll() : null
      restoreScroll = false
      if (saved) terminal.scrollBy(-Math.max(0, saved.total - saved.length - saved.offset))
      phase = 'awaiting-paint'
      terminal.refresh(0, terminal.appearance.grid.rows - 1)
    },
    paint() {
      if (phase !== 'awaiting-paint') return
      phase = 'ready'
      onReady(true)
    },
    close() {
      if (phase === 'closed') return
      phase = 'closed'
      onReady(false)
    },
  }
}
