import type { WideEventScope } from '@workspace/observability/scope'
import { WorkspaceEditOperationEvent } from '@/features/editor/state/workspace-edit-operation-event'
import { expect, test } from '../../../../test/fixtures'

test('emits one content-free operation event with counts phase durations and recovery paths', () => {
  const ended: Record<string, unknown>[] = []
  const context: Record<string, unknown> = {}
  const times = [10, 14, 24, 30, 38]
  const event = new WorkspaceEditOperationEvent({
    owner: { environmentId: 'owner-a', machine: 'Machine A' },
    rootGeneration: 7,
    sourceKind: 'language-server',
    createScope: (base) => scope(context, ended, base),
    now: () => times.shift() ?? 38,
    operationId: '10000000-0000-4000-8000-000000000063',
    source: 'code-action',
  })

  event.setPrepared({
    affectedPathCount: 4,
    dirtyTargetCount: 1,
    openTargetCount: 1,
    operationCount: 5,
    unopenedTargetCount: 2,
  })
  event.transition('preview')
  event.transition('committing')
  event.transition('rolling-back')
  event.end({
    outcome: 'recovery-required',
    recoveryPaths: ['src/a.ts', 'src/b.ts'],
    rollbackOutcome: 'partial',
  })
  event.end({ outcome: 'applied' })

  expect(ended).toEqual([
    {
      environmentId: 'owner-a',
      machine: 'Machine A',
      rootGeneration: 7,
      sourceKind: 'language-server',
      action: 'workspace_edit.apply',
      area: 'workspace-edit',
      counts: {
        affectedPathCount: 4,
        dirtyTargetCount: 1,
        openTargetCount: 1,
        operationCount: 5,
        unopenedTargetCount: 2,
      },
      durationMs: 28,
      operationId: '10000000-0000-4000-8000-000000000063',
      outcome: 'recovery-required',
      phaseDurationsMs: {
        committing: 6,
        preparing: 4,
        preview: 10,
        'rolling-back': 8,
      },
      recoveryPaths: ['src/a.ts', 'src/b.ts'],
      rollbackOutcome: 'partial',
      source: 'code-action',
    },
  ])
  expect(JSON.stringify(ended)).not.toContain('content')
  expect(JSON.stringify(ended)).not.toContain('text')
})

function scope(
  context: Record<string, unknown>,
  ended: Record<string, unknown>[],
  base: Record<string, unknown>,
): WideEventScope {
  Object.assign(context, base)
  return {
    count: () => 0,
    end: (overrides) => ended.push({ ...context, ...overrides }),
    error: () => undefined,
    getContext: () => context,
    increment: () => undefined,
    set: (next) => Object.assign(context, next),
    warn: () => undefined,
  }
}
