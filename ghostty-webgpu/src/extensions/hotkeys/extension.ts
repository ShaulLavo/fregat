import type { Extension } from '../types.js'
import {
  registerTerminalHotkeys,
  type TerminalHotkeyOwnership,
  type TerminalHotkeyRegistration,
} from './focus.js'
import type { TerminalClipboard, TerminalCommandId } from './commands.js'

export type TerminalHotkeysOptions = TerminalHotkeyOwnership & {
  readonly clipboard?: TerminalClipboard
  readonly onError?: (cause: unknown, operation: TerminalCommandId) => void
}

export interface TerminalHotkeyApi {
  readonly registration: TerminalHotkeyRegistration | undefined
}

export function hotkeys(
  options: TerminalHotkeysOptions = { mode: 'standalone' },
): Extension<TerminalHotkeyApi> {
  return {
    name: 'hotkeys',
    setup(scope) {
      const terminal = scope.terminal
      let registration: TerminalHotkeyRegistration | undefined
      function attach(element: HTMLElement): void {
        if (registration || scope.signal.aborted) return
        const clipboard =
          options.clipboard ?? element.ownerDocument.defaultView?.navigator.clipboard
        registration = registerTerminalHotkeys({
          ...options,
          element,
          terminal,
          clipboard,
          hasSelection: () => terminal.getSelection() !== undefined,
          signal: scope.signal,
          readState: () => terminal.inputModes,
          onError: options.onError ?? ((cause, operation) => console.error(operation, cause)),
        })
      }
      if (terminal.element && terminal.lifecycle === 'open') attach(terminal.element)
      scope.own(() => registration?.dispose())
      return {
        api: {
          get registration() {
            return registration
          },
        },
        events: { open: attach },
        input: (input) => {
          if (input.type !== 'key' || !('event' in input)) return 'pass'
          return registration?.claim(input.event) ?? 'pass'
        },
      }
    },
  }
}
