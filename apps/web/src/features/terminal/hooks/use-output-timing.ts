import { useEffect, useState } from 'react'
import type { Terminal, TerminalOutputTiming } from 'ghostty-webgpu'

/**
 * The latest output burst timing of `terminal` while `enabled`. Timing from an earlier terminal
 * (a remount) never shows for the current one, and nothing is recorded while disabled.
 */
export function useTerminalOutputTiming(terminal: Terminal | null, enabled: boolean) {
  const [latest, setLatest] = useState<{
    readonly terminal: Terminal
    readonly timing: TerminalOutputTiming
  } | null>(null)

  useEffect(() => {
    if (!enabled || !terminal) return

    const subscription = terminal.on('outputTiming', (timing) => setLatest({ terminal, timing }))
    return () => subscription.dispose()
  }, [enabled, terminal])

  if (!enabled || !latest || latest.terminal !== terminal) return null

  return latest.timing
}
