import { describe, expect, it } from 'vitest'

import type {
  WorkspaceEditPrepareRequest,
  WorkspaceEditRecoveryListResult,
  WorkspaceEditResult,
  WorkspacePersistenceOperation,
} from '../workspace-edit'

describe('workspace edit contracts', () => {
  it('represents every readonly ordered persistence operation', () => {
    const operations = [
      {
        expected: { kind: 'snapshot', mtimeMs: 1, version: 'sha256:before' },
        index: 0,
        kind: 'write',
        path: 'src/a.ts',
        text: 'after',
      },
      {
        destination: { kind: 'missing' },
        ignoreIfExists: false,
        index: 2,
        kind: 'create',
        overwrite: false,
        path: 'src/b.ts',
      },
      {
        destination: { kind: 'missing' },
        ignoreIfExists: false,
        index: 3,
        kind: 'rename',
        newPath: 'src/c.ts',
        oldPath: 'src/b.ts',
        overwrite: true,
        source: { afterOperation: 2, kind: 'transaction' },
      },
      {
        expected: { afterOperation: 3, kind: 'transaction' },
        ignoreIfNotExists: false,
        index: 4,
        kind: 'delete',
        path: 'src/c.ts',
        recursive: true,
      },
    ] as const satisfies readonly WorkspacePersistenceOperation[]
    const request = {
      bodyDigest: `sha256:${'a'.repeat(64)}`,
      category: 'workspace-edit',
      label: 'Workspace edit',
      operationId: 'd96f733e-61f8-42c4-b043-f18dc8cce052',
      operations,
      origin: 'workspace-edit',
      workspace: 'project',
    } as const satisfies WorkspaceEditPrepareRequest

    expect(request.operations.map((operation) => operation.kind)).toEqual([
      'write',
      'create',
      'rename',
      'delete',
    ])
    expect(request.operations[3].recursive).toBe(true)
  })

  it('represents every durable result state without filesystem contents', () => {
    const states = [
      'preparing',
      'prepared',
      'committed',
      'finalized',
      'aborted',
      'rolled-back',
      'undo-committed',
      'undone',
      'redo-committed',
      'redone',
      'partial',
      'released',
    ] as const

    for (const state of states) {
      const result = {
        affectedPaths: ['src/a.ts'],
        entries: [
          {
            exists: true,
            mtimeMs: 2,
            path: 'src/a.ts',
            size: 5,
            type: 'file',
            version: 'sha256:after',
          },
        ],
        eventPublication: 'pending',
        generation: 1,
        operationId: 'operation',
        rolledBackPaths: [],
        serverEpoch: 'epoch',
        state,
        unrecoveredPaths: [],
      } as const satisfies WorkspaceEditResult

      expect(JSON.stringify(result)).not.toContain('content')
      expect(JSON.stringify(result)).not.toContain('/private/')
    }
  })

  it('keeps partial recovery summaries relative and content-free', () => {
    const result = {
      operations: [
        {
          generation: 3,
          operationId: 'operation',
          recoveryTarget: 'rolled-back',
          unrecoveredPaths: ['src/a.ts'],
          workspace: 'project',
        },
      ],
      serverEpoch: 'epoch',
    } as const satisfies WorkspaceEditRecoveryListResult

    expect(result.operations[0].unrecoveredPaths).toEqual(['src/a.ts'])
  })
})
