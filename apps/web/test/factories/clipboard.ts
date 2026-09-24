type ClipboardMethod = 'writeText' | 'write' | 'execCommand'

type ClipboardWrite = { readonly method: ClipboardMethod; readonly text: string }

export type ClipboardStub = {
  /** Every successful write, in order, with the method that made it. */
  readonly written: ClipboardWrite[]
  /** The method exists and rejects, as a browser without permission does. */
  refuse(method: ClipboardMethod): void
  /** The method does not exist, as in an insecure origin or an embedded webview. */
  remove(method: ClipboardMethod): void
  restore(): void
}

/**
 * The browser clipboard is the outside world: all three write methods are
 * stubbed, each recording what reached it. happy-dom's own `ClipboardItem`
 * stays in place so the `write` path builds the real object.
 */
export function stubClipboard(): ClipboardStub {
  const written: ClipboardWrite[] = []
  const refused = new Set<ClipboardMethod>()
  const removed = new Set<ClipboardMethod>()
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const execCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')

  const allowed = (method: ClipboardMethod) => {
    if (!refused.has(method)) return
    throw new DOMException('', 'NotAllowedError')
  }

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    get: () => ({
      write: removed.has('write')
        ? undefined
        : async (items: readonly ClipboardItem[]) => {
            allowed('write')
            const blob = await items[0]!.getType('text/plain')
            written.push({ method: 'write', text: await blob.text() })
          },
      writeText: removed.has('writeText')
        ? undefined
        : async (text: string) => {
            allowed('writeText')
            written.push({ method: 'writeText', text })
          },
    }),
  })
  const copyCommand = (command: string) => {
    if (command !== 'copy' || refused.has('execCommand')) return false
    const field = document.activeElement
    if (!(field instanceof HTMLTextAreaElement)) return false
    written.push({ method: 'execCommand', text: field.value })
    return true
  }
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    get: () => (removed.has('execCommand') ? undefined : copyCommand),
  })

  return {
    written,
    refuse: (method) => refused.add(method),
    remove: (method) => removed.add(method),
    restore: () => {
      restoreProperty(navigator, 'clipboard', clipboard)
      restoreProperty(document, 'execCommand', execCommand)
    },
  }
}

function restoreProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
    return
  }
  Reflect.deleteProperty(target, key)
}
