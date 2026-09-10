import { createCliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'

import { Application } from '@/components/application'
import type { SettingsSession } from '@/connection/state/session'
import { createTuiError } from '@/host/utils/structured-errors'
import { foregroundJobGroup } from '@/host/job-control'
import { runTerminalAttach, type AttachTerminalRequest } from '@/host/attach'
import { readClipboardImage } from '@/host/clipboard-image'

export async function runInteractive(session: SettingsSession, noColor: boolean) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb') {
    throw createTuiError(
      'This session cannot display an interactive TUI.',
      'Run in an interactive terminal, or use --headless-frame <path>.',
    )
  }
  const closed = Promise.withResolvers<void>()
  const lifetime = new AbortController()
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined
  let root: ReturnType<typeof createRoot> | undefined
  let exitRequested = false
  let suspended = false
  const resume = () => {
    if (!suspended || exitRequested) return
    suspended = false
    renderer?.resume()
  }
  const suspend = () => {
    if (!renderer || process.platform === 'win32') return
    const group = foregroundJobGroup()
    if (group === null) return
    suspended = true
    renderer.suspend()
    process.kill(-group, 'SIGTSTP')
  }
  const close = () => {
    exitRequested = true
    lifetime.abort()
    closed.resolve()
  }
  const attachTerminal = async (request: AttachTerminalRequest) => {
    lifetime.signal.throwIfAborted()
    renderer?.suspend()
    try {
      await runTerminalAttach({
        ...request,
        signal: AbortSignal.any([request.signal, lifetime.signal]),
      })
    } finally {
      if (!exitRequested) renderer?.resume()
    }
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  process.on('SIGCONT', resume)
  try {
    renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: [],
      screenMode: 'alternate-screen',
      useKittyKeyboard: { events: true },
      consoleMode: 'console-overlay',
      openConsoleOnError: false,
      onDestroy: close,
    })
    if (exitRequested) return
    root = createRoot(renderer)
    root.render(
      <Application
        session={session}
        noColor={noColor}
        onExit={close}
        onSuspend={suspend}
        onAttachTerminal={attachTerminal}
        onReadClipboardImage={(signal) =>
          readClipboardImage(AbortSignal.any([signal, lifetime.signal]))
        }
      />,
    )
    void session.refresh()
    await closed.promise
  } finally {
    lifetime.abort()
    process.off('SIGINT', close)
    process.off('SIGTERM', close)
    process.off('SIGCONT', resume)
    session.dispose()
    try {
      root?.unmount()
    } finally {
      renderer?.destroy()
    }
  }
}
