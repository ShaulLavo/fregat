import { expect, test } from 'vitest'
import * as v from 'valibot'
import { isEvlogError } from '../../observability'
import { orchestrationCommandSchema, type OrchestrationCommand } from '@workspace/contracts'
import { commandAggregate } from '../command-receipts'
import { decideOrchestrationCommand } from '../decider'
import { createEmptyReadModel } from '../read-model'
import { MANAGED_ID } from './factories/worktree-domain'
import { DOMAIN_AT, DOMAIN_IDS } from './factories/session-domain'

type LifecycleCommandType = Extract<
  OrchestrationCommand,
  { type: `worktree.${string}` | `terminal.lease.${string}` | 'session.worktree.release' }
>['type']
const lease = { terminalLeaseId: '8cd29f12-b782-4946-9ee1-9c911ec71b59', runtimeEpoch: 'epoch' }
const result = { operationId: 'operation', mode: 'safe' }
const registration = {
  projectId: DOMAIN_IDS.project,
  canonicalPath: '/fixture',
  path: '/fixture',
  branch: null,
  registrationGeneration: 0,
  kind: 'linked',
  ownership: 'external',
  createdAt: DOMAIN_AT,
  updatedAt: DOMAIN_AT,
}

const commands = {
  'worktree.register': registration,
  'worktree.revive': { ...registration, retirementSequence: 1 },
  'worktree.retry': {},
  'worktree.cleanup': {},
  'worktree.force-cleanup': {
    authorization: { expectedHead: 'head', expectedStatusFingerprint: 'fingerprint' },
  },
  'worktree.retain': { verified: true },
  'worktree.adopt': { verified: true, branch: null, headCommit: 'head' },
  'worktree.release': {},
  'worktree.resolve-missing': {
    verified: true,
    authorization: {
      canonicalPath: '/fixture',
      registrationGeneration: 0,
      pathAbsent: true,
      adminAbsent: true,
    },
  },
  'worktree.create.complete': { operationId: 'operation', headCommit: 'head' },
  'worktree.create.fail': { operationId: 'operation', errorCode: 'git.FAILURE' },
  'worktree.cleanup.complete': result,
  'worktree.cleanup.blocked': { ...result, reason: 'dirty', changedFileCount: 1 },
  'worktree.cleanup.fail': { ...result, errorCode: 'git.FAILURE' },
  'worktree.mark-missing': {},
  'worktree.metadata.refresh': { expectedMetadataVersion: 0, branch: null, headCommit: null },
  'worktree.orphan.register': {
    projectId: DOMAIN_IDS.project,
    canonicalPath: '/fixture',
    path: '/fixture',
    branch: null,
    headCommit: null,
    pathKind: 'legacy',
    reason: 'unprojected-managed-path',
  },
  'session.worktree.release': {
    sessionId: DOMAIN_IDS.session,
    turnId: DOMAIN_IDS.turn,
    operationId: 'operation',
  },
  'terminal.lease.request': lease,
  'terminal.lease.claim': lease,
  'terminal.lease.activate': lease,
  'terminal.lease.terminate': lease,
  'terminal.lease.end': lease,
  'terminal.lease.mark-unknown': lease,
} satisfies Record<LifecycleCommandType, object>

test('every lifecycle command routes to an aggregate and produces events or a durable structured rejection', () => {
  for (const [type, payload] of Object.entries(commands)) {
    const command = v.parse(orchestrationCommandSchema, {
      commandId: `dispatch-${type}`,
      worktreeId: MANAGED_ID,
      type,
      ...payload,
    })
    expect(commandAggregate(command)).toEqual({
      kind: type.startsWith('session.') ? 'session' : 'worktree',
      id: type.startsWith('session.') ? DOMAIN_IDS.session : MANAGED_ID,
    })
    try {
      const events = decideOrchestrationCommand(command, createEmptyReadModel())
      expect(Array.isArray(events)).toBe(true)
    } catch (error) {
      expect(isEvlogError(error)).toBe(true)
      expect(error).toHaveProperty('status', expect.any(Number))
      expect(error).toHaveProperty('why', expect.any(String))
      expect(error).toHaveProperty('fix', expect.any(String))
    }
  }
})
