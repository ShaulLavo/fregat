import remend from 'remend'

import { endsInsideOpenFence } from './fence'

/**
 * Closes syntax the stream has not finished: `**bol` renders bold instead of
 * as literal asterisks. Text that stops inside a fence is left alone, because
 * the only place a closer could go is inside the code.
 */
export function healMarkdown(text: string): string {
  if (endsInsideOpenFence(text)) return text

  return remend(text)
}
