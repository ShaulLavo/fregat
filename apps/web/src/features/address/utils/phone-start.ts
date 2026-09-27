import { formatAddress, parseAddress } from '@workspace/client-core/address/grammar'
import { chatReferenceForToken } from '@workspace/client-core/address/references'

/** Resolve the phone's bare-URL destination before bootstrap starts applying its address. */
export function phoneStartAddress(initialHref: string, liveHref: string, coarsePointer: boolean) {
  if (!coarsePointer || initialHref === liveHref) return initialHref
  const address = parseAddress(initialHref)
  return formatAddress({
    ...address,
    mode: 'chat',
    document: null,
    editor: address.mode === 'chat' ? address.editor : address.document,
    screen: null,
  })
}

/** A pushed file, changes view or terminal loads through its own screen query. */
export function phoneBaseScreen(href: string): 'sessions' | 'session' {
  const address = parseAddress(href)
  return address.mode === 'chat' && chatReferenceForToken(address.document) ? 'session' : 'sessions'
}
