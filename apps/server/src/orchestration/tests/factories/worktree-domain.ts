import { onTestFinished } from 'vitest'
import * as v from 'valibot'
import { orchestrationCommandSchema } from '@workspace/contracts'
import { decideOrchestrationCommand } from '../../decider'
import { createProjectionFixture } from './projection'
import { domainBootstrap, DOMAIN_IDS, DOMAIN_MODEL } from './session-domain'

export const MANAGED_ID = 'c19636f4-df40-44a3-b8d2-e5201d9766a2'
export const SECOND_SESSION_ID = 'ba19c9d5-772d-4f7c-bfc8-9a02527263d6'

export function createWorktreeDomain() {
  const fixture = createProjectionFixture()
  onTestFinished(() => fixture.close())
  const bootstrap = domainBootstrap()
    .slice(0, 2)
    .map((event) => {
      if (event.type !== 'project.created') return event
      return { ...event, payload: { ...event.payload, repositoryKind: 'git' as const } }
    })
  fixture.pipeline.applyEvents(fixture.append(bootstrap))
  let next = 0
  const dispatch = (input: object) => {
    const command = v.parse(orchestrationCommandSchema, {
      commandId: `operation-${++next}`,
      ...input,
    })
    const events = decideOrchestrationCommand(command, fixture.snapshots.fullReadModel())
    const committed = fixture.append(events)
    fixture.pipeline.applyEvents(committed)
    return committed
  }
  const create = (bootstrapTurn = false) => {
    const worktreeTarget = {
      kind: 'new',
      worktreeId: MANAGED_ID,
      baseWorktreeId: DOMAIN_IDS.worktree,
    }
    const worktreeProvisioning = {
      worktreeId: MANAGED_ID,
      baseWorktreeId: DOMAIN_IDS.worktree,
      projectId: DOMAIN_IDS.project,
      branch: `worktree/${MANAGED_ID}`,
      baseCommit: 'a'.repeat(40),
      baseBranch: 'main',
      path: '/managed/checkout',
      canonicalPath: '/managed/checkout',
    }
    const session = { worktreeTarget, title: 'Managed', modelSelection: DOMAIN_MODEL }
    if (!bootstrapTurn)
      return dispatch({
        type: 'session.create',
        sessionId: DOMAIN_IDS.session,
        ...session,
        worktreeProvisioning,
      })
    return dispatch({
      type: 'session.turn.start',
      sessionId: DOMAIN_IDS.session,
      turnId: DOMAIN_IDS.turn,
      message: { messageId: 'original-message', role: 'user', text: 'Keep this exact message' },
      bootstrap: { createSession: session },
      worktreeProvisioning,
    })
  }
  const worktree = () => fixture.snapshots.fullReadModel().worktrees.get(MANAGED_ID)!
  const ready = () =>
    dispatch({
      type: 'worktree.create.complete',
      worktreeId: MANAGED_ID,
      operationId: worktree().operationId,
      headCommit: 'a'.repeat(40),
    })
  return { ...fixture, dispatch, create, ready, worktree }
}
