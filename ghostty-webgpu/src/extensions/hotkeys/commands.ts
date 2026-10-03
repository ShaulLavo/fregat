import type { CommandHandler } from '@fregat/hotkeys'
import type { Terminal } from '../../dom/terminal.js'
import type { TerminalAppearance } from '../../term/types.js'

const commandIds = [
  'terminal.copy',
  'terminal.paste',
  'terminal.selectAll',
  'terminal.clear',
  'terminal.fontSizeIncrease',
  'terminal.fontSizeDecrease',
  'terminal.fontSizeReset',
  'terminal.sendKeystroke',
] as const

export type TerminalCommandId = (typeof commandIds)[number]

export type TerminalCommandTarget = {
  readonly appearance: TerminalAppearance
} & {
  [Name in 'getSelection' | 'paste' | 'selectAll' | 'write' | 'setFont' | 'key' | 'sendInput']: (
    ...args: Parameters<Terminal[Name]>
  ) => ReturnType<Terminal[Name]> | Promise<ReturnType<Terminal[Name]>>
}

export interface TerminalClipboard {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
}

export interface TerminalCommandOptions {
  readonly terminal: TerminalCommandTarget
  readonly clipboard?: TerminalClipboard
  readonly signal: AbortSignal
  readonly onError: (cause: unknown, operation: TerminalCommandId) => void
  readonly sendKeystroke: CommandHandler<KeyboardEvent>
}

export function createTerminalCommands(
  options: TerminalCommandOptions,
): Readonly<Record<TerminalCommandId, CommandHandler<KeyboardEvent>>> {
  const terminal = options.terminal
  const initialFontSize = terminal.appearance.font.size
  let fontQueue = Promise.resolve()
  function fontSize(size: () => number): Promise<void> {
    const next = fontQueue.then(async () => {
      if (!options.signal.aborted) await terminal.setFont({ size: size() })
    })
    fontQueue = next.catch(() => {})
    return next
  }
  function action(id: TerminalCommandId, run: () => unknown): CommandHandler<KeyboardEvent> {
    return () => {
      if (options.signal.aborted) return false
      try {
        void Promise.resolve(run()).catch((cause: unknown) => options.onError(cause, id))
      } catch (cause) {
        options.onError(cause, id)
      }
      return true
    }
  }
  async function copy(): Promise<void> {
    const text = await terminal.getSelection()
    if (options.signal.aborted || text === undefined) return
    await options.clipboard?.writeText(text)
  }
  async function paste(): Promise<void> {
    const text = await options.clipboard?.readText()
    if (options.signal.aborted || text === undefined) return
    await terminal.paste(text)
  }
  return {
    'terminal.copy': options.clipboard ? action('terminal.copy', copy) : () => false,
    'terminal.paste': options.clipboard ? action('terminal.paste', paste) : () => false,
    'terminal.selectAll': action('terminal.selectAll', () => terminal.selectAll()),
    'terminal.clear': action('terminal.clear', () => terminal.write('\u001b[3J\u001b[2J\u001b[H')),
    'terminal.fontSizeIncrease': action('terminal.fontSizeIncrease', () =>
      fontSize(() => terminal.appearance.font.size + 1),
    ),
    'terminal.fontSizeDecrease': action('terminal.fontSizeDecrease', () =>
      fontSize(() => Math.max(1, terminal.appearance.font.size - 1)),
    ),
    'terminal.fontSizeReset': action('terminal.fontSizeReset', () =>
      fontSize(() => initialFontSize),
    ),
    'terminal.sendKeystroke': options.sendKeystroke,
  }
}
