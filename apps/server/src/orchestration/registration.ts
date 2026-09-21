import { mkdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  PreparedProjectCreateCommand,
  ProjectCreateCommand,
  RepositoryIdentity,
} from '@workspace/contracts'
import type { WorkspacePaths } from '../fs/path'
import type { GitService } from '../git/service'
import { normalizeGitRemoteUrl } from '../git/utils/remote-url'
import { orchestrationErrors } from '../observability'
import type { OrchestrationReadModel } from './read-model'
import { currentWorktree } from './read-model'
import {
  projectIdForRepository,
  repositoryKey,
  worktreeIdForCheckout,
} from './utils/repository-ids'
import { sessionDomainErrors } from './structured-errors'

export type RegistrationBoundary = { readonly git: GitService; readonly paths: WorkspacePaths }

export async function prepareProjectRegistration(
  input: ProjectCreateCommand,
  boundary: RegistrationBoundary,
  model: OrchestrationReadModel,
  intentFingerprint: string,
): Promise<PreparedProjectCreateCommand> {
  const inputPath = await canonicalRegistrationPath(input, boundary.paths)
  const repository = await boundary.git.repo(inputPath)
  const canonicalPath = repository.repository
    ? await realpath(boundary.paths.resolve(repository.repository.path).absolutePath)
    : inputPath
  boundary.paths.assertRealInside(canonicalPath)
  const existing = Array.from(model.worktrees.values()).find(
    (worktree) => worktree.canonicalPath === canonicalPath && !worktree.retiredAt,
  )
  const registeredProject = existing ? model.projects.get(existing.projectId) : undefined
  const identity =
    registeredProject?.repositoryIdentity ??
    (await resolveRepositoryIdentity(boundary.git, canonicalPath, repository.repository !== null))
  const key = registeredProject?.repositoryKey ?? repositoryKey(identity)
  const projectId = projectIdForRepository(key)
  const worktreeId = worktreeIdForCheckout(key, canonicalPath)
  const previous = model.worktrees.get(worktreeId)
  const current = currentWorktree(model, projectId)
  const isCurrent = !current || current.id === worktreeId
  const at = new Date().toISOString()

  return {
    ...input,
    projectId,
    worktreeId,
    repositoryIdentity: identity,
    repositoryKey: key,
    repositoryKind:
      registeredProject?.repositoryKind ?? (repository.repository ? 'git' : 'directory'),
    canonicalPath,
    path: boundary.paths.toRealRelative(canonicalPath),
    branch: repository.repository?.branch ?? null,
    registrationGeneration: previous?.registrationGeneration ?? 0,
    kind: isCurrent ? 'current' : 'linked',
    ownership: isCurrent ? 'protected' : 'external',
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
    intentFingerprint,
  }
}

export async function resolveRepositoryIdentity(
  git: GitService,
  canonicalPath: string,
  isGit: boolean,
): Promise<RepositoryIdentity> {
  if (!isGit) return { source: 'path', canonical: canonicalPath }

  const remote = await git.remoteUrl(canonicalPath, 'origin')
  const canonical = remote ? normalizeGitRemoteUrl(remote) : null
  if (canonical) {
    const separator = canonical.indexOf('/')
    return {
      source: 'git-remote',
      remoteName: 'origin',
      canonical,
      host: canonical.slice(0, separator),
      path: canonical.slice(separator + 1),
    }
  }
  const rootCommit = await git.rootCommit(canonicalPath)
  if (rootCommit) return { source: 'root-commit', canonical: rootCommit }

  throw sessionDomainErrors.REPOSITORY_IDENTITY_UNAVAILABLE({
    internal: { tried: ['remote', 'root-commit'], hasRootCommit: Boolean(rootCommit) },
  })
}

async function canonicalRegistrationPath(input: ProjectCreateCommand, paths: WorkspacePaths) {
  const absolutePath = path.isAbsolute(input.workspaceRoot)
    ? path.resolve(input.workspaceRoot)
    : paths.resolve(input.workspaceRoot).absolutePath
  paths.assertInside(absolutePath)
  await ensureDirectory(absolutePath, input.createWorkspaceRootIfMissing === true, paths)
  const canonicalPath = await realpath(absolutePath)
  paths.assertRealInside(canonicalPath)
  return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath
}

async function ensureDirectory(
  workspaceRoot: string,
  createIfMissing: boolean,
  paths: WorkspacePaths,
) {
  const existing = await stat(workspaceRoot).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return null
    throw error
  })
  if (existing?.isDirectory()) return
  if (existing) throw orchestrationErrors.WORKSPACE_ROOT_NOT_DIRECTORY({ workspaceRoot })
  if (!createIfMissing) throw orchestrationErrors.WORKSPACE_ROOT_NOT_DIRECTORY({ workspaceRoot })

  let ancestor = path.dirname(workspaceRoot)
  for (;;) {
    const canonicalAncestor = await realpath(ancestor).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return null
      throw error
    })
    if (canonicalAncestor) {
      paths.assertRealInside(canonicalAncestor)
      break
    }
    ancestor = path.dirname(ancestor)
  }
  await mkdir(workspaceRoot, { recursive: true })
}
