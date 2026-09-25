// After t3code (MIT, T3 Tools Inc.): packages/client-runtime/src/textPaste.ts at 7445aa73.

/** Pasted text this large becomes a file, so the agent can read it selectively. */
export const PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES = 32 * 1024

const encoder = new TextEncoder()

/** Ctrl/Cmd+Shift+V, the usual paste-as-plain-text chord, keeps a large paste inline. */
export function isPasteAsTextShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
) {
  if (event.key.toLowerCase() !== 'v' || !event.shiftKey || event.altKey) return false

  return event.ctrlKey !== event.metaKey
}

/** Byte-based: a character count understates what Unicode-heavy text costs. */
export function pastedTextFolds(text: string, bypass: boolean) {
  if (bypass || text.length === 0) return false
  if (text.length >= PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES) return true

  return encoder.encode(text).byteLength >= PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES
}

/** `pasted-text.txt`, then `pasted-text-2.txt` and on, skipping names already taken. */
export function nextPastedTextFileName(taken: ReadonlySet<string>) {
  if (!taken.has('pasted-text.txt')) return 'pasted-text.txt'
  for (let sequence = 2; ; sequence += 1) {
    const name = `pasted-text-${sequence}.txt`
    if (!taken.has(name)) return name
  }
}
