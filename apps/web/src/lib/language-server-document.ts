import { fileUriForPath } from '@workspace/contracts'

import { encodedViewTarget } from '@/lib/documents/utils/codec'
import { documentKey } from '@/lib/documents/utils/identity'
import type { DocumentKey, DocumentRef } from '@/lib/documents/utils/types'

export type LanguageServerDocument = {
  readonly key: DocumentKey
  readonly uri: string
}

export function languageServerDocument(document: DocumentRef): LanguageServerDocument | null {
  if (document.kind === 'file') {
    return { key: documentKey(document), uri: fileUriForPath(document.resource.path) }
  }
  if (document.kind === 'settings-json') {
    return { key: documentKey(document), uri: encodedViewTarget(document) }
  }
  return null
}
