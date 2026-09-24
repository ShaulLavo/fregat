import type { MutationOptions } from '@tanstack/react-query'
import { defineErrorCatalog } from 'evlog'
import { toast } from 'sonner'

import { log } from '@/lib/client-logging'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'

type ClipboardMethod = 'writeText' | 'write' | 'execCommand'

type ClipboardAttempt = {
  readonly error: string
  readonly method: ClipboardMethod
}

export type CopyRequest = {
  /** Names the payload in feedback: "Copied {label}", "Could not copy {label}". */
  readonly label: string
  readonly text: string
}

const clipboardErrors = defineErrorCatalog('clipboard', {
  WRITE_REFUSED: {
    status: 400,
    message: 'The browser refused the clipboard write',
    why: 'Every clipboard write method this page can reach was missing or refused.',
    fix: 'Click into the page and copy again; if it keeps failing, allow clipboard access for this site.',
  },
})

const clipboardMutationKeys = {
  writeText: ['clipboard', 'write-text'] as const,
}

/**
 * Newest method first. A missing method is skipped synchronously, so the first
 * available one still runs inside the click that asked for it.
 */
const methods: readonly (readonly [ClipboardMethod, (text: string) => Promise<void>])[] = [
  ['writeText', writeWithWriteText],
  ['write', writeWithClipboardItem],
  ['execCommand', writeWithExecCommand],
]

export async function writeClipboardText(text: string): Promise<ClipboardMethod> {
  const attempts: ClipboardAttempt[] = []
  for (const [method, write] of methods) {
    try {
      await write(text)
      return method
    } catch (error) {
      attempts.push({ error: attemptErrorName(error), method })
    }
  }
  throw clipboardErrors.WRITE_REFUSED({ internal: { attempts } })
}

export function copyTextMutationOptions(): MutationOptions<ClipboardMethod, unknown, CopyRequest> {
  return {
    mutationFn: ({ text }) => writeClipboardText(text),
    mutationKey: clipboardMutationKeys.writeText,
    onError: (error, { label }) => {
      // The label names the payload; the payload itself never reaches the log.
      log.warn({ action: 'clipboard.copy_failed', area: 'clipboard', error, label })
      toast.error(`Could not copy ${label}`, { description: clipboardErrors.WRITE_REFUSED.fix })
    },
  }
}

/** Menu and command feedback: one success toast. Resolves false after a reported failure. */
export async function copyTextToClipboard(text: string, label: string): Promise<boolean> {
  try {
    await runMutation(primaryQueryClient(), copyTextMutationOptions(), { label, text })
  } catch {
    return false
  }
  toast.success(`Copied ${label}`)
  return true
}

function writeWithWriteText(text: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText !== 'function') return missing()
  return navigator.clipboard.writeText(text)
}

function writeWithClipboardItem(text: string): Promise<void> {
  if (typeof navigator.clipboard?.write !== 'function') return missing()
  if (typeof ClipboardItem !== 'function') return missing()

  const blob = new Blob([text], { type: 'text/plain' })
  return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
}

/** Deprecated, but the only method some embedded webviews and insecure origins offer. */
function writeWithExecCommand(text: string): Promise<void> {
  if (typeof document.execCommand !== 'function') return missing()

  const restore = captureFocusAndSelection()
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.append(textarea)
  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    if (document.execCommand('copy')) return Promise.resolve()
    return Promise.reject(new DOMException('', 'NotAllowedError'))
  } finally {
    textarea.remove()
    restore()
  }
}

function captureFocusAndSelection() {
  const focused = document.activeElement
  const selection = document.getSelection()
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : []

  return () => {
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
    if (!selection) return
    selection.removeAllRanges()
    for (const range of ranges) selection.addRange(range)
  }
}

function missing(): Promise<never> {
  return Promise.reject(new DOMException('', 'NotSupportedError'))
}

function attemptErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
