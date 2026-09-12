import { fileDocument, fileResource } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { editorDocumentToken, type Address } from '@workspace/client-core/address/grammar'
import { documentTokenForContent } from '@/features/address/utils/document-token'

export function addressForRenamedFile(
  address: Address,
  root: string | null,
  from: FilesystemPath,
  to: FilesystemPath,
): Address {
  const before = documentTokenForContent(root, documentTab(fileDocument(fileResource(from))))
  const after = documentTokenForContent(root, documentTab(fileDocument(fileResource(to))))
  if (before.kind !== 'token' || after.kind !== 'token') return address
  const replace = (token: string | null) => (token === before.token ? after.token : token)
  return {
    ...address,
    document: replace(address.document),
    editor: replace(address.editor),
    tabs: address.tabs?.map((token) => replace(token) ?? token) ?? null,
  }
}

export function addressForDeletedFile(
  address: Address,
  root: string | null,
  path: FilesystemPath,
): Address {
  const token = documentTokenForContent(root, documentTab(fileDocument(fileResource(path))))
  if (token.kind !== 'token') return address
  const tabs = address.tabs?.filter((entry) => entry !== token.token) ?? null
  if (editorDocumentToken(address) !== token.token) return { ...address, tabs }
  const selected = tabs?.[0] ?? null
  return {
    ...address,
    ...(address.mode === 'chat' ? { editor: selected } : { document: selected }),
    tabs,
    focus: null,
  }
}
