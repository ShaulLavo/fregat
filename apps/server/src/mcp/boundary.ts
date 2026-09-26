import path from 'node:path'

import { FsError } from '../fs/errors'
import { createWorkspacePaths, isOutsideRoot, resolveExistingPath } from '../fs/path'
import type { McpGrant } from './grants'

/**
 * A path an agent names, resolved inside its grant's checkout only: absolute or relative, and
 * through symlinks, which may not lead out. Another checkout with the same relative paths is out.
 */
export async function resolveGrantPath(grant: McpGrant, input: string) {
  const paths = createWorkspacePaths(grant.cwd)
  return resolveExistingPath(paths, checkoutRelative(grant.cwd, input))
}

function checkoutRelative(cwd: string, input: string) {
  if (!path.isAbsolute(input)) return input
  const relative = path.relative(cwd, input)
  if (isOutsideRoot(relative)) throw new FsError('PATH_OUTSIDE_WORKSPACE')
  return relative.split(path.sep).join('/')
}
