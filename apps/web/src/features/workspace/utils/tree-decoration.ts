import type { FileTreeRowDecoration, FileTreeRowDecorationContext } from '@workspace/tree'
import type { AgentErrorInput } from '@/lib/agent-error-report'
import { canonicalTreePath } from '@/lib/path-formatters'
import type { TreeModel } from '@/lib/tree-model'

/**
 * The folder's load state beside its name: `no access`, `error` or `loading`. A failure carries
 * "Fix with AI", which hands `fix` what the row knows about it.
 */
export function treeRowDecoration(
  model: TreeModel,
  context: FileTreeRowDecorationContext,
  fix: (error: AgentErrorInput) => void,
): FileTreeRowDecoration | null {
  const treePath = canonicalTreePath(context.item.path)
  const error = model.errorByDirectoryPath.get(treePath)
  const path = `/${model.entriesByTreePath.get(treePath)?.path ?? treePath}`
  if (error?.denied) {
    const message = `The server's user cannot read ${path}`
    return {
      text: 'no access',
      title: message,
      action: fixAction(
        { code: 'PERMISSION_DENIED', message, title: 'The file tree has no access to a folder' },
        fix,
      ),
    }
  }
  if (error) {
    return {
      text: 'error',
      title: error.message,
      action: fixAction(
        { message: `${path}: ${error.message}`, title: 'The file tree could not list a folder' },
        fix,
      ),
    }
  }
  if (model.loadingDirectoryPaths.has(treePath)) return { text: 'loading' }

  return null
}

function fixAction(error: AgentErrorInput, fix: (error: AgentErrorInput) => void) {
  return { label: 'Fix with AI', onActivate: () => fix(error) }
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
