import type { SettingsValues } from '@workspace/contracts'

export type SendShortcut = SettingsValues['chat.sendShortcut']

/** What an Enter press asks for: nothing (a new line), a send, or the alternate send. */
export type EnterIntent = 'newline' | 'send' | 'alternate'

/**
 * After t3code's `composerSubmissionIntentForEnter`. Where the modifier is the send key,
 * the alternate send (queue/steer swap, background start) takes Shift as well.
 */
export function composerEnterIntent(input: {
  readonly modifierKey: boolean
  readonly prompt: string
  readonly sendShortcut: SendShortcut
  readonly shiftKey: boolean
}): EnterIntent {
  const modifierSends =
    input.sendShortcut === 'mod-enter' ||
    (input.sendShortcut === 'mod-enter-multiline' && /[\r\n]/.test(input.prompt))
  if (!modifierSends) {
    if (input.shiftKey) return 'newline'
    return input.modifierKey ? 'alternate' : 'send'
  }
  if (!input.modifierKey) return 'newline'

  return input.shiftKey ? 'alternate' : 'send'
}
