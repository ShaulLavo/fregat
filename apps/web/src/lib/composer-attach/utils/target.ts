import type { ComposerDestination } from '@/lib/composer-attach/providers/context'

/**
 * The roots one composer answers to. A session in a linked worktree is reached from the editor's
 * workspace root, the worktree path and its canonical path, and each names the same composer.
 */
export type ComposerTarget = {
  readonly environmentId: ComposerDestination['environmentId']
  readonly rootPaths: readonly string[]
}

export function composerAccepts(target: ComposerTarget, destination: ComposerDestination) {
  return (
    destination.environmentId === target.environmentId &&
    target.rootPaths.includes(destination.rootPath)
  )
}
