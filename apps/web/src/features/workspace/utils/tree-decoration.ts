import type { FileTreeRowDecorationContext } from '@workspace/tree'
import { canonicalTreePath } from '@/lib/path-formatters'
import type { TreeModel } from '@/lib/tree-model'

/** The folder's load state beside its name: `no access`, `error` or `loading`. */
export function treeRowDecoration(model: TreeModel, context: FileTreeRowDecorationContext) {
  const treePath = canonicalTreePath(context.item.path)
  const error = model.errorByDirectoryPath.get(treePath)
  if (error?.denied) {
    const path = model.entriesByTreePath.get(treePath)?.path ?? treePath
    return { text: 'no access', title: `The server's user cannot read /${path}` }
  }
  if (error) return { text: 'error', title: error.message }
  if (model.loadingDirectoryPaths.has(treePath)) return { text: 'loading' }

  return null
}

/**
 * What the decorations above read, as one value. Every model update clones these sets, so their
 * identity changes far more often than anything a row shows.
 */
export function treeDecorationKey(model: TreeModel) {
  const errors = [...model.errorByDirectoryPath].map(
    ([path, error]) => `${error.denied ? 'denied' : 'error'}:${path}:${error.message}`,
  )
  const loading = [...model.loadingDirectoryPaths].map((path) => `loading:${path}`)
  return [...errors, ...loading].toSorted().join('\n')
}
