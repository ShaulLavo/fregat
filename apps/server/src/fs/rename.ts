import { rename } from 'node:fs/promises'
import { FsError, mapNodeError } from './errors'
import {
  assertExistingPath,
  assertDisjointTargets,
  removeDestinationIfAllowed,
  type MutationTarget,
} from './mutation-target'
import type { RenameBody } from './contracts'

export async function renamePath(
  { from, to }: { from: MutationTarget<'entry'>; to: MutationTarget<'entry'> },
  body: Omit<RenameBody, 'from' | 'to'>,
) {
  try {
    assertDisjointTargets(from, to)
    await assertExistingPath(from.absolutePath)
    await removeDestinationIfAllowed(to.absolutePath, body.overwrite)
    await rename(from.absolutePath, to.absolutePath)

    return {
      from: from.relativePath,
      to: to.relativePath,
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}
