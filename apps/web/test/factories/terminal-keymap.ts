import { GhosttyRuntime, Terminal, hotkeys, type GhosttyWebGpuRenderer } from 'ghostty-webgpu'
import { detectPlatform } from '@fregat/hotkeys'
import { flushSync } from 'react-dom'

import { useCommand } from '@/keymap/hooks/use-command'
import type { PlatformKeyBinding } from '@/keymap/types'
import { FocusService } from '@/lib/focus/state/service'

import { renderHookWithProviders } from '../render'

export async function createTerminalKeymap(bindings: readonly PlatformKeyBinding[]) {
  const host = document.createElement('div')
  host.className = 'h-40 w-96'
  document.body.append(host)
  const runtime = await GhosttyRuntime.create()
  const terminal = await Terminal.create({
    rendererFactory: async () => keyboardTestRenderer(),
    runtime: { kind: 'borrowed', runtime },
  })
  await terminal.open(host)
  const output: string[] = []
  const decoder = new TextDecoder()
  const subscription = terminal.onData((bytes) => output.push(decoder.decode(bytes)))
  const focus = new FocusService()
  const registration = focus.register({
    area: 'terminal',
    element: host,
    id: { kind: 'terminal', rootPath: '/repo', sessionId: 'keymap-browser' },
    onIntent: () => {
      terminal.focus()
      return true
    },
  })
  const alternateTarget = document.createElement('button')
  alternateTarget.textContent = 'Another terminal owner'
  document.body.append(alternateTarget)
  const alternateRegistration = focus.register({
    area: 'terminal',
    element: alternateTarget,
    id: { kind: 'terminal', rootPath: '/repo', sessionId: 'alternate' },
    onIntent: () => {
      alternateTarget.focus()
      return true
    },
  })
  const calls: boolean[] = []
  const view = renderHookWithProviders(useCommand, {
    command: {
      bindings,
      runtime: {
        settings: {
          setWallpaperEnabled: (enabled) => {
            calls.push(enabled)
            return { kind: 'noop' }
          },
        },
      },
    },
    focusService: focus,
  })
  const errors: unknown[] = []
  terminal.use(
    hotkeys({
      mode: 'hosted',
      dispatcher: view.result.current.keymap.hotkeys,
      parent: view.result.current.keymap.parentFor('terminal'),
      platform: detectPlatform(),
      onError: (cause) => errors.push(cause),
    }),
  )
  flushSync(() => terminal.focus())

  return {
    alternateTarget,
    calls,
    focus,
    errors,
    output,
    pendingChord: () => view.result.current.pendingChord,
    terminal,
    dispose: () => {
      view.unmount()
      registration.unregister()
      alternateRegistration.unregister()
      subscription.dispose()
      terminal.dispose()
      runtime.dispose()
      host.remove()
      alternateTarget.remove()
    },
  }
}

// The GPU is outside this proof; the DOM host, keyboard encoder and wasm are real.
function keyboardTestRenderer(): GhosttyWebGpuRenderer {
  return {
    dispose: () => {},
    notifyScroll: () => {},
    notifySelectionChange: () => {},
    notifyWrite: () => {},
    resize: () => {},
    schedule: () => {},
    setCursorBlinkEnabled: () => {},
    setDocumentVisible: () => {},
    setFocused: () => {},
    setFont: () => {},
    setTheme: () => {},
  }
}
