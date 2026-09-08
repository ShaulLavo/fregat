import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceAddress, WorkspaceAddressId, WorkspaceRootEntry } from '@workspace/contracts'
import { FsError, mapNodeError } from './errors'
import type { FsMetadataStore } from './metadata'
import type { WorkspacePaths } from './path'
import { statPath } from './stat'

export async function registerWorkspaceAddress(
  paths: WorkspacePaths,
  metadata: FsMetadataStore,
  input: string,
): Promise<WorkspaceRootEntry> {
  const { canonicalPath, entry } = await canonicalDirectory(paths, input)
  const id = metadata.registerWorkspaceAddress(paths.workspaceRootReal, canonicalPath)
  return { ...entry, workspaceAddress: address(id, canonicalPath, entry.path) }
}

export async function resolveWorkspaceAddress(
  paths: WorkspacePaths,
  metadata: FsMetadataStore,
  id: WorkspaceAddressId,
): Promise<WorkspaceAddress> {
  const stored = metadata.findWorkspaceAddress(paths.workspaceRootReal, id)
  if (!stored) throw new FsError('WORKSPACE_ADDRESS_NOT_FOUND')

  const { canonicalPath, entry } = await canonicalDirectory(
    paths,
    paths.toRealRelative(stored.canonicalPath),
  )
  if (canonicalPath !== stored.canonicalPath) throw new FsError('WORKSPACE_ADDRESS_NOT_FOUND')
  return address(id, canonicalPath, entry.path)
}

async function canonicalDirectory(paths: WorkspacePaths, input: string) {
  const target = paths.resolve(input)
  try {
    const canonicalPath = await realpath(target.absolutePath)
    paths.assertRealInside(canonicalPath)
    const entry = await statPath(paths, paths.toRealRelative(canonicalPath))
    if (entry.type !== 'directory') throw new FsError('NOT_A_DIRECTORY')
    return { canonicalPath, entry }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

function address(
  id: WorkspaceAddressId,
  canonicalPath: string,
  relativePath: string,
): WorkspaceAddress {
  return { id, name: path.basename(canonicalPath) || 'Workspace', path: relativePath }
}
