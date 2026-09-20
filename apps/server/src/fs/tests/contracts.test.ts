import { workspaceSearchMatchSchema as cachedSearchMatchSchema } from '@workspace/contracts'
import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import {
  booleanQueryValueSchema,
  searchQuerySchema,
  treeEntrySchema,
  treeQuerySchema,
  workspaceEditPrepareBodySchema,
  workspaceEditReleaseBodySchema,
  workspaceEditResultSchema,
  workspaceSearchEventSchema,
  workspaceSearchMatchSchema,
} from '../contracts'

describe('filesystem contracts', () => {
  it('accepts every ordered workspace edit operation and preserves option precedence', () => {
    const body = workspaceEditPrepareBody([
      {
        destination: { kind: 'missing' },
        ignoreIfExists: true,
        index: 0,
        kind: 'create',
        overwrite: true,
        path: 'src/a.ts',
      },
      {
        expected: { afterOperation: 0, kind: 'transaction' },
        index: 2,
        kind: 'write',
        path: 'src/a.ts',
        text: 'next',
      },
      {
        destination: { kind: 'missing' },
        ignoreIfExists: false,
        index: 3,
        kind: 'rename',
        newPath: 'src/b.ts',
        oldPath: 'src/a.ts',
        overwrite: true,
        source: { afterOperation: 2, kind: 'transaction' },
      },
      {
        expected: { afterOperation: 3, kind: 'transaction' },
        ignoreIfNotExists: true,
        index: 4,
        kind: 'delete',
        path: 'src/b.ts',
        recursive: true,
      },
    ])

    expect(v.parse(workspaceEditPrepareBodySchema, body)).toEqual(body)
  })

  it('rejects invalid workspace edit paths preconditions order and unknown fields', () => {
    const validWrite = {
      expected: { kind: 'snapshot', mtimeMs: 1, version: 'sha256:before' },
      index: 0,
      kind: 'write',
      path: 'src/a.ts',
      text: 'next',
    } as const

    expect(
      v.safeParse(
        workspaceEditPrepareBodySchema,
        workspaceEditPrepareBody([validWrite], { extra: true }),
      ).success,
    ).toBe(false)
    expect(
      v.safeParse(
        workspaceEditPrepareBodySchema,
        workspaceEditPrepareBody([{ ...validWrite, path: '../outside.ts' }]),
      ).success,
    ).toBe(false)
    expect(
      v.safeParse(
        workspaceEditPrepareBodySchema,
        workspaceEditPrepareBody([
          validWrite,
          { ...validWrite, expected: { kind: 'snapshot', mtimeMs: 1, version: 'stale' }, index: 1 },
        ]),
      ).success,
    ).toBe(false)
    expect(
      v.safeParse(
        workspaceEditPrepareBodySchema,
        workspaceEditPrepareBody([
          { ...validWrite, expected: { afterOperation: 1, kind: 'transaction' } },
        ]),
      ).success,
    ).toBe(false)
  })

  it('requires exact sorted partial acknowledgement paths', () => {
    const base = {
      acknowledgePartial: {
        generation: 2,
        unrecoveredPaths: ['src/a.ts', 'src/b.ts'],
      },
      expectedGeneration: 2,
      operationId: 'd96f733e-61f8-42c4-b043-f18dc8cce052',
      transitionId: '070527de-f9d0-40de-94cd-9af95e3a0a3b',
    }

    expect(v.safeParse(workspaceEditReleaseBodySchema, base).success).toBe(true)
    expect(
      v.safeParse(workspaceEditReleaseBodySchema, {
        ...base,
        acknowledgePartial: {
          ...base.acknowledgePartial,
          unrecoveredPaths: ['src/b.ts', 'src/a.ts'],
        },
      }).success,
    ).toBe(false)
  })

  it('accepts every result state and keeps response paths relative and content-free', () => {
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
      'released',
    ] as const

    for (const state of states) {
      expect(v.safeParse(workspaceEditResultSchema, workspaceEditResult(state)).success).toBe(true)
    }
    expect(
      v.safeParse(workspaceEditResultSchema, {
        ...workspaceEditResult('partial'),
        recoveryTarget: 'rolled-back',
        unrecoveredPaths: ['src/a.ts'],
      }).success,
    ).toBe(true)
    expect(
      v.safeParse(workspaceEditResultSchema, {
        ...workspaceEditResult('finalized'),
        entries: [{ content: 'secret', exists: false, path: 'src/a.ts' }],
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(workspaceEditResultSchema, {
        ...workspaceEditResult('finalized'),
        affectedPaths: ['/private/workspace/src/a.ts'],
      }).success,
    ).toBe(false)
  })

  it('parses query booleans and clamps bounded integer query values', () => {
    expect(v.parse(booleanQueryValueSchema, 'true')).toBe(true)
    expect(v.parse(booleanQueryValueSchema, '0')).toBe(false)
    expect(v.parse(treeQuerySchema, { depth: '99', path: 'src' })).toEqual({
      depth: 10,
      path: 'src',
    })
  })

  it('parses search queries with defaults', () => {
    expect(v.parse(searchQuerySchema, { query: 'button' })).toEqual({
      caseSensitive: false,
      includeContent: false,
      includeNames: true,
      limit: 50,
      matchMode: 'literal',
      path: '',
      query: 'button',
      streamNameMatchesEarly: true,
      useWorkspaceIndex: true,
      wholeWord: false,
    })
  })

  it('preserves whitespace in search query text', () => {
    expect(v.parse(searchQuerySchema, { query: '  ' })).toMatchObject({
      query: '  ',
    })
  })

  it('parses search mode and glob query values', () => {
    expect(
      v.parse(searchQuerySchema, {
        caseSensitive: '1',
        excludeGlobs: '*.test.ts',
        includeGlobs: ['src/**/*.ts', 'tests/{unit,integration}/**/*.ts'],
        matchMode: 'regex',
        query: 'button',
        streamNameMatchesEarly: '0',
        wholeWord: 'true',
      }),
    ).toMatchObject({
      caseSensitive: true,
      excludeGlobs: ['*.test.ts'],
      includeGlobs: ['src/**/*.ts', 'tests/{unit,integration}/**/*.ts'],
      matchMode: 'regex',
      streamNameMatchesEarly: false,
      wholeWord: true,
    })
  })

  it('validates shared tree entry shape', () => {
    expect(
      v.parse(treeEntrySchema, {
        birthtimeMs: 1,
        mtimeMs: 2,
        name: 'index.ts',
        path: 'src/index.ts',
        size: 42,
        targetType: 'file',
        type: 'file',
        version: 'stat:2:42',
      }),
    ).toEqual({
      birthtimeMs: 1,
      mtimeMs: 2,
      name: 'index.ts',
      path: 'src/index.ts',
      size: 42,
      targetType: 'file',
      type: 'file',
      version: 'stat:2:42',
    })
  })

  it('validates shared workspace search event shapes', () => {
    const match = {
      column: 7,
      endColumn: 13,
      kind: 'content',
      line: 3,
      path: 'src/app.ts',
      preview: 'const result = search()',
      source: 'disk',
      type: 'file',
    } as const

    expect(v.parse(workspaceSearchMatchSchema, match)).toEqual(match)
    expect(
      v.parse(workspaceSearchEventSchema, {
        match,
        type: 'match',
      }),
    ).toEqual({
      match,
      type: 'match',
    })
    expect(
      v.parse(workspaceSearchEventSchema, {
        count: 1,
        measurement: {
          durationMs: 12.5,
          firstResultMs: 3.25,
          providerSources: ['fd'],
          providers: [
            {
              durationMs: 10,
              firstResultMs: 2,
              resultCount: 1,
              source: 'fd',
              statCallCount: 1,
              statDurationMs: 1.5,
            },
          ],
          repeatedStatPathCount: 0,
          statCallCount: 1,
          statDurationMs: 1.5,
          statPathCount: 1,
          topStatPaths: [{ count: 1, durationMs: 1.5, path: 'src/app.ts' }],
          workspaceIndex: {
            fallbackReason: 'stale',
            pendingCreatedPathCount: 1,
            readiness: 'stale',
            staleEntryCount: 0,
            used: false,
          },
        },
        path: '',
        query: 'app',
        truncated: false,
        type: 'done',
      }),
    ).toMatchObject({
      measurement: {
        providerSources: ['fd'],
        statCallCount: 1,
        workspaceIndex: {
          fallbackReason: 'stale',
          pendingCreatedPathCount: 1,
        },
      },
      type: 'done',
    })
  })
})

function workspaceEditPrepareBody(
  operations: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    bodyDigest: `sha256:${'a'.repeat(64)}`,
    operationId: 'd96f733e-61f8-42c4-b043-f18dc8cce052',
    operations,
    origin: 'workspace-edit',
    workspace: 'project',
    ...extra,
  }
}

function workspaceEditResult(state: string) {
  return {
    affectedPaths: ['src/a.ts'],
    entries: [
      {
        exists: true,
        mtimeMs: 2,
        path: 'src/a.ts',
        size: 4,
        type: 'file',
        version: 'sha256:after',
      },
    ],
    eventPublication: 'pending',
    generation: 1,
    operationId: 'd96f733e-61f8-42c4-b043-f18dc8cce052',
    rolledBackPaths: [],
    serverEpoch: '070527de-f9d0-40de-94cd-9af95e3a0a3b',
    state,
    unrecoveredPaths: [],
  }
}

it('keeps request path limits separate from persisted search matches', () => {
  const match = { kind: 'name', path: 'x'.repeat(4097), source: 'disk', type: 'file' }
  expect(v.safeParse(workspaceSearchMatchSchema, match).success).toBe(false)
  expect(v.parse(cachedSearchMatchSchema, match)).toEqual(match)
  expect(v.safeParse(cachedSearchMatchSchema, { ...match, source: 'unknown' }).success).toBe(false)
})
