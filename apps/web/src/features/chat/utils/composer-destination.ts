import type { ComposerDestination } from '@/lib/composer-attach/providers/context'

export function sameComposerDestination(left: ComposerDestination, right: ComposerDestination) {
  return left.environmentId === right.environmentId && left.rootPath === right.rootPath
}
