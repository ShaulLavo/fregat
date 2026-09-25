import { TickerNumber } from '@/components/ticker-number'
import { Spinner } from '@workspace/ui/components/spinner'
import type { LoadState } from '@/lib/load-state'
import type { TreeModel } from '@/lib/tree-model'

export function TreeHeaderDetail({
  treeState,
  visibleTreeItemCount,
}: {
  treeState?: LoadState<TreeModel>
  visibleTreeItemCount: number | null
}) {
  if (!treeState) return null
  if (treeState.status === 'loading')
    return (
      <span className='flex items-center gap-1.5'>
        <Spinner size='xs' label='Loading files' />
        Loading…
      </span>
    )
  if (treeState.status === 'error') return 'Unable to load files'
  if (visibleTreeItemCount === null) return null

  return <TickerNumber value={visibleTreeItemCount} />
}
