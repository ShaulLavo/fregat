import type { Stats } from 'node:fs'
import { lstat, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { FsError, mapNodeError } from './errors'
import { nodeErrorCode } from '@workspace/contracts'
import { isOutsideRoot, type WorkspacePath, type WorkspacePaths } from './path'

export type MutationTargetKind = 'content' | 'entry'

export type MutationTarget<Kind extends MutationTargetKind = MutationTargetKind> = Readonly<
  WorkspacePath & { kind: Kind }
>

export async function resolveMutationTarget<Kind extends MutationTargetKind>(
  paths: WorkspacePaths,
  input: { path: string; kind: Kind },
): Promise<MutationTarget<Kind>> {
  const target = paths.resolve(input.path)
  assertNotRootTarget(target.relativePath)

  try {
    const absolutePath = await resolvePhysicalTarget(paths, target.absolutePath, input.kind)
    return { absolutePath, relativePath: target.relativePath, kind: input.kind }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

async function resolvePhysicalTarget(
  paths: WorkspacePaths,
  absolutePath: string,
  kind: MutationTargetKind,
) {
  if (kind === 'content') return resolvePhysicalPath(paths, absolutePath)

  // Entry operations follow parent links but rename, copy, or remove the final link itself.
  const parent = await resolvePhysicalPath(paths, path.dirname(absolutePath))
  const target = path.join(parent, path.basename(absolutePath))
  paths.assertRealInside(target)
  return target
}

async function resolvePhysicalPath(paths: WorkspacePaths, absolutePath: string): Promise<string> {
  try {
    const resolved = await realpath(absolutePath)
    paths.assertRealInside(resolved)
    return resolved
  } catch (error) {
    if (nodeErrorCode(error) !== 'ENOENT') throw error
  }

  // A dangling link is an existing entry, not a missing suffix that creation may fill in.
  const stats = await lstatOptional(absolutePath)
  if (stats?.isSymbolicLink() || absolutePath === paths.workspaceRoot) {
    throw new FsError('NOT_FOUND')
  }

  const parent = await resolvePhysicalPath(paths, path.dirname(absolutePath))
  return path.join(parent, path.basename(absolutePath))
}

export function assertDisjointTargets(from: MutationTarget<'entry'>, to: MutationTarget<'entry'>) {
  const toRelative = path.relative(from.absolutePath, to.absolutePath)
  const fromRelative = path.relative(to.absolutePath, from.absolutePath)
  if (isOutsideRoot(toRelative) && isOutsideRoot(fromRelative)) return

  throw new FsError('INVALID_PATH', 'source and destination must not overlap')
}

function assertNotRootTarget(relativePath: string) {
  if (relativePath) return

  throw new FsError('INVALID_PATH', 'operation cannot target the workspace root')
}

export async function assertExistingPath(absolutePath: string) {
  return lstat(absolutePath)
}

async function destinationExists(absolutePath: string) {
  return (await lstatOptional(absolutePath)) !== null
}

export async function statOptional(absolutePath: string): Promise<Stats | null> {
  return statOptionalVia(stat, absolutePath, 'error')
}

export async function lstatOptional(absolutePath: string): Promise<Stats | null> {
  return statOptionalVia(lstat, absolutePath, 'error')
}

export async function removeDestinationIfAllowed(absolutePath: string, overwrite?: boolean) {
  if (!(await destinationExists(absolutePath))) return
  if (!overwrite) throw new FsError('ALREADY_EXISTS')

  await rm(absolutePath, { recursive: true, force: false })
}

/** Journal probes treat a non-directory parent as absent; direct mutations preserve its error. */
export async function statOptionalVia(
  read: (target: string) => Promise<Stats>,
  target: string,
  missingParent: 'absent' | 'error' = 'absent',
): Promise<Stats | null> {
  try {
    return await read(target)
  } catch (error) {
    const code = nodeErrorCode(error)
    if (code === 'ENOENT' || (code === 'ENOTDIR' && missingParent === 'absent')) return null
    throw error
  }
}
