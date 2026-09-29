import { describe, expect, it } from 'vitest'

import { parseWorkspaceEdit } from '../src/workspaceEdit'

const range = (start: number, end: number) => ({
  end: { character: end, line: 0 },
  start: { character: start, line: 0 },
})

const textOperation = (uri: string, version: number | null, newText = 'x') => ({
  edits: [{ newText, range: range(0, 1) }],
  textDocument: { uri, version },
})

describe('parseWorkspaceEdit', () => {
  it('preserves interleaved create edit rename delete operations and every option', () => {
    const result = parseWorkspaceEdit({
      documentChanges: [
        {
          kind: 'create',
          options: { ignoreIfExists: true, overwrite: true },
          uri: 'file:///new.ts',
        },
        textOperation('file:///new.ts', null),
        {
          kind: 'rename',
          newUri: 'file:///renamed.ts',
          oldUri: 'file:///new.ts',
          options: { ignoreIfExists: true, overwrite: false },
        },
        {
          kind: 'delete',
          options: { ignoreIfNotExists: true, recursive: true },
          uri: 'file:///old.ts',
        },
      ],
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.operations).toEqual([
      {
        ignoreIfExists: true,
        kind: 'create',
        overwrite: true,
        uri: 'file:///new.ts',
      },
      {
        edits: [{ newText: 'x', range: range(0, 1) }],
        kind: 'text-document',
        uri: 'file:///new.ts',
        version: null,
      },
      {
        ignoreIfExists: true,
        kind: 'rename',
        newUri: 'file:///renamed.ts',
        oldUri: 'file:///new.ts',
        overwrite: false,
      },
      {
        ignoreIfNotExists: true,
        kind: 'delete',
        recursive: true,
        uri: 'file:///old.ts',
      },
    ])
  })

  it('preserves annotations, edit annotation ids, and needsConfirmation', () => {
    const result = parseWorkspaceEdit({
      changeAnnotations: {
        confirm: {
          description: 'Touches generated output',
          label: 'Generate',
          needsConfirmation: true,
        },
        quiet: { label: 'Rename' },
      },
      documentChanges: [
        {
          annotationId: 'quiet',
          edits: [{ annotationId: 'confirm', newText: 'next', range: range(0, 1) }],
          textDocument: { uri: 'file:///a.ts', version: 4 },
        },
        { annotationId: 'confirm', kind: 'create', uri: 'file:///b.ts' },
      ],
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect([...result.value.annotations]).toEqual([
      [
        'confirm',
        {
          description: 'Touches generated output',
          label: 'Generate',
          needsConfirmation: true,
        },
      ],
      ['quiet', { label: 'Rename', needsConfirmation: false }],
    ])
    expect(result.value.operations).toMatchObject([
      { annotationId: 'quiet', edits: [{ annotationId: 'confirm' }] },
      { annotationId: 'confirm' },
    ])
  })

  it('preserves repeated text document operations and integer and null versions', () => {
    const result = parseWorkspaceEdit({
      documentChanges: [
        textOperation('file:///a.ts', 8, 'first'),
        textOperation('file:///a.ts', 9, 'second'),
        textOperation('file:///b.ts', null, 'third'),
      ],
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.operations).toMatchObject([
      { kind: 'text-document', uri: 'file:///a.ts', version: 8 },
      { kind: 'text-document', uri: 'file:///a.ts', version: 9 },
      { kind: 'text-document', uri: 'file:///b.ts', version: null },
    ])
  })

  it('normalizes legacy changes in lexicographic URI order with null versions', () => {
    const result = parseWorkspaceEdit({
      changes: {
        'file:///z.ts': [{ newText: 'z', range: range(0, 0) }],
        'file:///a.ts': [{ newText: 'a', range: range(0, 0) }],
      },
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(
      result.value.operations.map((operation) => ({
        uri: operation.kind === 'text-document' ? operation.uri : '',
        version: operation.kind === 'text-document' ? operation.version : undefined,
      })),
    ).toEqual([
      { uri: 'file:///a.ts', version: null },
      { uri: 'file:///z.ts', version: null },
    ])
  })

  it('rejects a payload containing both executable shapes', () => {
    expect(parseWorkspaceEdit({ changes: {}, documentChanges: [] })).toMatchObject({
      error: { code: 'invalid-workspace-edit' },
      ok: false,
    })
  })

  it('rejects malformed coordinates and missing annotation references atomically', () => {
    expect(
      parseWorkspaceEdit({
        documentChanges: [
          textOperation('file:///valid.ts', null),
          {
            edits: [{ newText: 'x', range: range(0, 1.5) }],
            textDocument: { uri: 'file:///bad.ts', version: null },
          },
        ],
      }),
    ).toEqual({
      error: {
        code: 'invalid-position',
        editIndex: 0,
        operationIndex: 1,
        reason: 'Position line and character must be non-negative integers',
      },
      ok: false,
    })

    expect(
      parseWorkspaceEdit({
        changeAnnotations: { known: { label: 'Known' } },
        documentChanges: [
          textOperation('file:///valid.ts', null),
          {
            edits: [{ annotationId: 'missing', newText: 'x', range: range(0, 1) }],
            textDocument: { uri: 'file:///bad.ts', version: null },
          },
        ],
      }),
    ).toMatchObject({
      error: { code: 'invalid-annotation', editIndex: 0, operationIndex: 1 },
      ok: false,
    })
  })

  it('rejects snippet edits without returning the surrounding valid operations', () => {
    const result = parseWorkspaceEdit({
      documentChanges: [
        textOperation('file:///before.ts', null),
        {
          edits: [{ range: range(0, 0), snippet: { kind: 'snippet', value: '${1:name}' } }],
          textDocument: { uri: 'file:///snippet.ts', version: null },
        },
        textOperation('file:///after.ts', null),
      ],
    })

    expect(result).toEqual({
      error: {
        code: 'unsupported-snippet',
        editIndex: 0,
        operationIndex: 1,
        reason: 'Snippet text edits are unsupported',
      },
      ok: false,
    })
  })

  it('preserves an unsupported scheme for host policy', () => {
    const result = parseWorkspaceEdit({
      documentChanges: [textOperation('untitled:pending.ts', null)],
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.operations).toMatchObject([{ uri: 'untitled:pending.ts' }])
  })

  it('returns an empty ordered plan for an absent edit and not for malformed input', () => {
    for (const input of [null, undefined, {}]) {
      expectEmptyWorkspaceEdit(input)
    }

    expect(parseWorkspaceEdit('not an edit')).toMatchObject({
      error: { code: 'invalid-workspace-edit' },
      ok: false,
    })
    expect(parseWorkspaceEdit({ documentChanges: {} })).toMatchObject({
      error: { code: 'invalid-workspace-edit' },
      ok: false,
    })
  })
})

function expectEmptyWorkspaceEdit(input: unknown): void {
  const result = parseWorkspaceEdit(input)
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) return
  expect(result.value.operations).toEqual([])
  expect(result.value.annotations.size).toBe(0)
}
