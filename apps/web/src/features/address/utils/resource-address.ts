import { editorDocumentToken, type Address } from '@workspace/client-core/address/grammar'
import { documentTokenForPath } from '@/features/address/utils/document-token'

export function addressForRenamedFile(
  address: Address,
  root: string | null,
  from: string,
  to: string,
): Address {
  const before = documentTokenForPath(root, from)
  const after = documentTokenForPath(root, to)
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
  path: string,
): Address {
  const token = documentTokenForPath(root, path)
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
