import type { OrchestrationCommand, ProjectRegistrationResult } from '@workspace/contracts'
import { event, one } from './event-factory'
import type { OrchestrationReadModel } from './read-model'
import { currentWorktree, requireProject } from './read-model'
import { sessionDomainErrors } from './structured-errors'

type Registration = Extract<OrchestrationCommand, { type: 'project.create' | 'project.revive' }>
type WorktreeRegistration = Extract<
  OrchestrationCommand,
  { type: 'worktree.register' | 'worktree.revive' }
>

export function registrationResult(
  command: Registration,
  model: OrchestrationReadModel,
): ProjectRegistrationResult {
  const project = model.projects.get(command.projectId)
  const worktree = model.worktrees.get(command.worktreeId)
  let disposition: ProjectRegistrationResult['disposition'] = 'created-project'
  if (project && !project.deletedAt) disposition = 'registered-worktree'
  if (project?.deletedAt) disposition = 'revived-project'
  if (worktree && !worktree.retiredAt) disposition = 'existing-worktree'
  return { projectId: command.projectId, worktreeId: command.worktreeId, disposition }
}

export function decideRegistration(
  command: Registration,
  model: OrchestrationReadModel,
  at: string,
) {
  requireRegistrationIdentity(command, model)
  const project = model.projects.get(command.projectId)
  const worktree = model.worktrees.get(command.worktreeId)
  if (project?.deletedAt) requireProviderOwnershipReleased(model, command.projectId)
  if (!project?.deletedAt && worktree?.retiredAt)
    requireProviderOwnershipReleased(model, command.projectId, command.worktreeId)
  if (worktree && !worktree.retiredAt) return []

  const events = []
  if (!project || project.deletedAt) {
    events.push(
      event(command, at, project ? 'project.revived' : 'project.created', {
        projectId: command.projectId,
        repositoryKey: command.repositoryKey,
        repositoryKind: command.repositoryKind,
        repositoryIdentity: command.repositoryIdentity,
        title: command.title,
        defaultModelSelection: command.defaultModelSelection,
        createdAt: project?.createdAt ?? at,
        updatedAt: at,
      }),
    )
  }
  const current = currentWorktree(model, command.projectId)
  const isCurrent = !current || current.id === command.worktreeId
  events.push(
    event(command, at, worktree ? 'worktree.revived' : 'worktree.registered', {
      worktreeId: command.worktreeId,
      projectId: command.projectId,
      registrationGeneration: worktree ? worktree.registrationGeneration + 1 : 0,
      canonicalPath: command.canonicalPath,
      path: command.path,
      branch: command.branch,
      kind: isCurrent ? 'current' : 'linked',
      ownership: isCurrent ? 'protected' : 'external',
      createdAt: worktree?.createdAt ?? at,
      updatedAt: at,
    }),
  )
  return events
}

export function decideWorktreeCommand(
  command: WorktreeRegistration,
  model: OrchestrationReadModel,
  at: string,
) {
  requireProject(model, command.projectId)
  requireCheckoutIdentity(command, model)
  const existing = model.worktrees.get(command.worktreeId)
  if (existing && !existing.retiredAt) return []
  if (existing) requireWorktreeRevival(command, model, existing.retirementSequence)
  if (!existing && command.type === 'worktree.revive')
    throw sessionDomainErrors.WORKTREE_NOT_FOUND(command)
  requireCurrentWorktreeAvailable(command, model)
  return one(command, at, existing ? 'worktree.revived' : 'worktree.registered', {
    worktreeId: command.worktreeId,
    projectId: command.projectId,
    canonicalPath: command.canonicalPath,
    path: command.path,
    branch: command.branch,
    kind: command.kind,
    ownership: command.ownership,
    registrationGeneration: existing ? existing.registrationGeneration + 1 : 0,
    createdAt: existing?.createdAt ?? command.createdAt,
    updatedAt: command.updatedAt,
  })
}

function requireProviderOwnershipReleased(
  model: OrchestrationReadModel,
  projectId: string,
  worktreeId?: string,
) {
  for (const session of model.sessions.values()) {
    if (worktreeId && session.worktreeId !== worktreeId) continue
    if (model.worktrees.get(session.worktreeId)?.projectId !== projectId) continue
    const stop = session.deletion?.providerStop
    if (session.deletedAt && (stop === 'completed' || stop === 'no-binding')) continue
    throw sessionDomainErrors.REGISTRATION_BUSY({ projectId })
  }
}

function requireRegistrationIdentity(command: Registration, model: OrchestrationReadModel) {
  const existing = model.projects.get(command.projectId)
  if (
    existing &&
    (existing.repositoryKey !== command.repositoryKey ||
      existing.repositoryKind !== command.repositoryKind ||
      existing.repositoryIdentity.source !== command.repositoryIdentity.source ||
      existing.repositoryIdentity.canonical !== command.repositoryIdentity.canonical)
  ) {
    throw sessionDomainErrors.IDENTITY_COLLISION({ id: command.projectId })
  }
  for (const project of model.projects.values()) {
    if (project.deletedAt || project.id === command.projectId) continue
    if (project.repositoryKey !== command.repositoryKey) continue
    throw sessionDomainErrors.IDENTITY_COLLISION({ id: command.projectId })
  }
  requireCheckoutIdentity(command, model)
}

function requireCheckoutIdentity(
  command: Registration | WorktreeRegistration,
  model: OrchestrationReadModel,
) {
  const existing = model.worktrees.get(command.worktreeId)
  if (
    existing &&
    (existing.canonicalPath !== command.canonicalPath || existing.projectId !== command.projectId)
  ) {
    throw sessionDomainErrors.IDENTITY_COLLISION({ id: command.worktreeId })
  }
  for (const worktree of model.worktrees.values()) {
    if (worktree.retiredAt || worktree.id === command.worktreeId) continue
    if (worktree.canonicalPath !== command.canonicalPath) continue
    throw sessionDomainErrors.WORKTREE_PATH_TAKEN({ worktreeId: worktree.id })
  }
}

function requireWorktreeRevival(
  command: WorktreeRegistration,
  model: OrchestrationReadModel,
  sequence: number | null,
) {
  if (command.type !== 'worktree.revive' || command.retirementSequence !== sequence) {
    throw sessionDomainErrors.IDENTITY_COLLISION({ id: command.worktreeId })
  }
  requireProviderOwnershipReleased(model, command.projectId, command.worktreeId)
}

function requireCurrentWorktreeAvailable(
  command: WorktreeRegistration,
  model: OrchestrationReadModel,
) {
  if (command.kind !== 'current') return
  for (const worktree of model.worktrees.values()) {
    if (
      worktree.projectId !== command.projectId ||
      worktree.retiredAt ||
      worktree.kind !== 'current'
    )
      continue
    throw sessionDomainErrors.IDENTITY_COLLISION({ id: command.worktreeId })
  }
}
