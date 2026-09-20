import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
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
        <OrbitLoader className='size-(--icon-size-sm) shrink-0' label='Loading files' />
        Loading…
      </span>
    )
  if (treeState.status === 'error') return 'Unable to load files'
  return visibleTreeItemCount
}
