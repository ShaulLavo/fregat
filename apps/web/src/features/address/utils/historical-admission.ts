import type { QueryClient } from '@tanstack/react-query'
import { editorDocumentToken, type Address } from '@workspace/client-core/address/grammar'
import { contentForDocumentToken } from '@/features/address/utils/document-token'
import { matchesHistoricalTarget } from '@/lib/documents/utils/comparisons'
import { commitDetailsQueryOptions } from '@/lib/git-commit-details-query'

export async function admitHistoricalAddress(
  queries: QueryClient,
  rootPath: string,
  address: Address,
) {
  const selected = editorDocumentToken(address)
  const tokens = [...new Set([...(address.tabs ?? []), ...(selected ? [selected] : [])])]
  const admitted = await Promise.all(
    tokens.map(async (token) => {
      const parsed = contentForDocumentToken(rootPath, token)
      if (
        parsed.kind !== 'content' ||
        parsed.content.kind !== 'document' ||
        parsed.content.document.kind !== 'git-diff'
      )
        return { token, admitted: true }
      const source = parsed.content.document.source
      if (source.kind !== 'snapshot' || source.target.kind !== 'historical')
        return { token, admitted: true }
      const target = source.target
      const details = await queries
        .query(commitDetailsQueryOptions(rootPath, target.origin.id))
        .catch(() => null)
      return { token, admitted: details !== null && matchesHistoricalTarget(target, details) }
    }),
  )
  const rejected = new Set(admitted.filter((entry) => !entry.admitted).map((entry) => entry.token))
  return {
    address: { ...address, tabs: address.tabs?.filter((token) => !rejected.has(token)) ?? null },
    selectedRejected: selected !== null && rejected.has(selected),
  }
}
