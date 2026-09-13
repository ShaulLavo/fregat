import type Electrobun from 'electrobun/main'

type BeforeQuitEvent = ReturnType<typeof Electrobun.events.events.app.beforeQuit>

export function createQuitHandler({
  cleanup,
  quit,
  reportError,
}: {
  readonly cleanup: () => Promise<void>
  readonly quit: () => void
  readonly reportError: (error: unknown) => void
}) {
  let phase: 'running' | 'stopping' | 'ready' = 'running'

  async function finish() {
    try {
      await cleanup()
    } catch (error) {
      reportError(error)
    } finally {
      phase = 'ready'
      quit()
    }
  }

  return (event: BeforeQuitEvent) => {
    if (phase === 'ready') return
    event.response = { allow: false }
    if (phase === 'stopping') return
    phase = 'stopping'
    void finish()
  }
}
