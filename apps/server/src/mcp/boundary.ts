import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'

import { FsError, mapNodeError } from '../fs/errors'
import { createWorkspacePaths, isOutsideRoot } from '../fs/path'
import { isWasiRuntime } from '../system/runtime'
import type { McpGrant } from './grants'
import { openedPath } from './opened-path'

/** Pin the checkout and validate the file descriptor that the reader will consume. */
export async function openGrantFile(grant: McpGrant, input: string) {
  const paths = createWorkspacePaths(grant.cwd)
  const target = paths.resolve(checkoutRelative(grant.cwd, input))
  if (isWasiRuntime()) return openWasiGrantFile(paths.workspaceRootReal, target)
  const root = await open(
    paths.workspaceRootReal,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    const rootPath = await openedPath(root.fd)
    if (rootPath !== paths.workspaceRootReal) throw new FsError('FILE_CHANGED')
    const candidate =
      process.platform === 'linux'
        ? path.join(`/proc/self/fd/${root.fd}`, target.relativePath)
        : target.absolutePath
    const file = await open(
      candidate,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const actual = await openedPath(file.fd)
      if (isOutsideRoot(path.relative(rootPath, actual)))
        throw new FsError('PATH_OUTSIDE_WORKSPACE')
      return file
    } catch (error) {
      await file.close()
      throw error
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  } finally {
    await root.close()
  }
}

async function openWasiGrantFile(
  workspaceRootReal: string,
  target: { readonly absolutePath: string },
) {
  try {
    const actual = await realpath(target.absolutePath)
    if (isOutsideRoot(path.relative(workspaceRootReal, actual)))
      throw new FsError('PATH_OUTSIDE_WORKSPACE')
    return await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

function checkoutRelative(cwd: string, input: string) {
  if (!path.isAbsolute(input)) return input
  const relative = path.relative(cwd, input)
  if (isOutsideRoot(relative)) throw new FsError('PATH_OUTSIDE_WORKSPACE')
  return relative.split(path.sep).join('/')
}
