import { useQuery } from '@tanstack/react-query'
import { useDiffDocumentDiffs } from '@/features/git/hooks/use-diff-document-diffs'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { EditorTabRecord } from '@/lib/documents/utils/types'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'

/** The tab label and body share the held subject, including checkpoint blob hydration. */
export function useShownComparisonTab(next: EditorTabRecord | null) {
  const target = next?.content.kind === 'document' ? next.content.document : null
  const comparison = target?.kind === 'git-diff' ? target.source : null
  const savedPath = target?.kind === 'compare-saved' ? target.file.path : null
  const diff = useDiffDocumentDiffs(comparison)
  const saved = useQuery({
    ...fileSnapshotQueryOptions(savedPath ?? filesystemPath('')),
    enabled: savedPath !== null,
  })
  const pending = diff.pending || (savedPath !== null && saved.isPending)
  const shown = useHeldUntilReady(next, !pending)
  return { shown, pending }
}
