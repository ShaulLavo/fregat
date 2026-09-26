import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { onTestFinished } from 'vitest'
import * as v from 'valibot'
import {
  projectIdSchema,
  worktreeIdSchema,
  type PreparedProjectCreateCommand,
  orchestrationCommandSchema,
} from '@workspace/contracts'
import { initializePlatformDatabase } from '../../../db/initialize'
import * as schema from '../../../db/schema'
import { OrchestrationEngine } from '../../engine'

import { DOMAIN_AT, DOMAIN_IDS, DOMAIN_MODEL } from './session-domain'

export function domainCommand(value: unknown) {
  return v.parse(orchestrationCommandSchema, value)
}

export function fixtureProjectId(index = 1) {
  if (index === 1) return v.parse(projectIdSchema, DOMAIN_IDS.project)
  return v.parse(projectIdSchema, `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
}

export function fixtureWorktreeId(index = 1) {
  if (index === 1) return v.parse(worktreeIdSchema, DOMAIN_IDS.worktree)
  return v.parse(worktreeIdSchema, `b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
}

export function projectRegistrationCommand(
  index = 1,
  overrides: Partial<PreparedProjectCreateCommand> = {},
) {
  return domainCommand({
    type: 'project.create',
    commandId: `project-create-${index}`,
    projectId: fixtureProjectId(index),
    worktreeId: fixtureWorktreeId(index),
    title: `Project ${index}`,
    workspaceRoot: `project-${index}`,
    canonicalPath: `/workspace/project-${index}`,
    path: `project-${index}`,
    repositoryKey: `fixture-repository-${index}`,
    repositoryKind: 'directory',
    repositoryIdentity: { source: 'path', canonical: `/workspace/project-${index}` },
    registrationGeneration: 0,
    branch: null,
    kind: 'current',
    ownership: 'protected',
    defaultModelSelection: DOMAIN_MODEL,
    createdAt: DOMAIN_AT,
    updatedAt: DOMAIN_AT,
    intentFingerprint: `fixture-registration-${index}`,
    ...overrides,
  })
}

export function sessionCreateCommand(
  sessionId: string = DOMAIN_IDS.session,
  commandId = 'session-create',
) {
  return domainCommand({
    type: 'session.create',
    commandId,
    sessionId,
    worktreeTarget: { kind: 'current', worktreeId: DOMAIN_IDS.worktree },
    title: 'Session',
    modelSelection: DOMAIN_MODEL,
    runtimeMode: 'full-access',
    interactionMode: 'default',
  })
}

export function createDomainEngine() {
  const sqlite = new Database(':memory:', { create: true })
  const database = drizzle({ client: sqlite, schema })
  initializePlatformDatabase(database)
  const engine = new OrchestrationEngine(database)
  onTestFinished(async () => {
    await engine.close()
    sqlite.close()
  })
  return { database, engine }
}

export async function createEngineWithSession() {
  const { engine } = createDomainEngine()
  await engine.dispatch(projectRegistrationCommand())
  await engine.dispatch(sessionCreateCommand())
  return engine
}
