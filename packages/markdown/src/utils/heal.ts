import remend from 'remend'

/**
 * Closes syntax the stream has not finished: `**bol` renders bold instead of
 * as literal asterisks. The caller keeps text that stops inside a fence away
 * from here, because remend would append the closers inside the code.
 */
export function healMarkdown(text: string): string {
  return remend(text)
}
