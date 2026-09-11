import { cp } from 'node:fs/promises'
import { FsError, mapNodeError } from './errors'
import {
  assertExistingPath,
  assertDisjointTargets,
  removeDestinationIfAllowed,
  type MutationTarget,
} from './mutation-target'
import type { CopyBody } from './contracts'

export async function copyPath(
  { from, to }: { from: MutationTarget<'entry'>; to: MutationTarget<'entry'> },
  body: Omit<CopyBody, 'from' | 'to'>,
) {
  try {
    assertDisjointTargets(from, to)
    const source = await assertExistingPath(from.absolutePath)
    if (source.isDirectory() && !body.recursive) {
      throw new FsError('INVALID_PATH', 'directory copy requires recursive: true')
    }
    await removeDestinationIfAllowed(to.absolutePath, body.overwrite)
    await cp(from.absolutePath, to.absolutePath, {
      dereference: false,
      recursive: Boolean(body.recursive),
      errorOnExist: !body.overwrite,
      force: Boolean(body.overwrite),
    })

    return {
      from: from.relativePath,
      to: to.relativePath,
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}
