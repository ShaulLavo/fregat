import { describe, expect, it, vi } from 'vitest'

import {
  EditorDisplayProjectionRegistry,
  FULL_DISPLAY_PROJECTION_INVALIDATION,
  NO_DISPLAY_PROJECTION_DISPOSAL,
  type EditorDisplayProjectionSource,
} from '../src/editor/displayProjectionRegistry'
import type { FoldRange } from '../src/syntax'

const source: EditorDisplayProjectionSource = {
  documentId: 'doc.ts',
  documentVersion: 1,
  textVersion: 2,
}

describe('EditorDisplayProjectionRegistry', () => {
  it('orders projections by layer, priority, and first owner registration', () => {
    const registry = new EditorDisplayProjectionRegistry()

    registry.set(rowProjection('third', 0, 2, 'third-row'))
    registry.set(rowProjection('first', 0, 0, 'first-row'))
    registry.set(rowProjection('second', 0, 0, 'second-row'))
    registry.set(rowProjection('last-layer', 1, 0, 'last-row'))

    expect(registry.values('rowDecorations').map((projection) => projection.owner)).toEqual([
      'first',
      'second',
      'third',
      'last-layer',
    ])
  })

  it('preserves owner order when a projection value is replaced', () => {
    const registry = new EditorDisplayProjectionRegistry()

    registry.set(rowProjection('first', 0, 0, 'first-row'))
    registry.set(rowProjection('second', 0, 0, 'second-row'))
    registry.replaceValue('rowDecorations', 'first', new Map([[0, { className: 'updated' }]]))

    expect(registry.values('rowDecorations').map((projection) => projection.owner)).toEqual([
      'first',
      'second',
    ])
    expect(registry.get('rowDecorations', 'first')?.value.get(0)?.className).toBe('updated')
  })

  it('retags projection source versions without changing order', () => {
    const registry = new EditorDisplayProjectionRegistry()
    const nextSource = { ...source, documentVersion: 3, textVersion: 4 }

    registry.set(rowProjection('first', 0, 0, 'first-row'))
    registry.set(rowProjection('second', 0, 0, 'second-row'))
    registry.retagKind('rowDecorations', nextSource)

    expect(registry.values('rowDecorations').map((projection) => projection.owner)).toEqual([
      'first',
      'second',
    ])
    expect(registry.get('rowDecorations', 'first')?.source).toEqual(nextSource)
  })

  it('disposes replaced and deleted projection resources', () => {
    const registry = new EditorDisplayProjectionRegistry()
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()

    registry.set(rowProjection('owned', 0, 0, 'first', firstDispose))
    registry.set(rowProjection('owned', 0, 0, 'second', secondDispose))
    registry.delete('rowDecorations', 'owned')

    expect(firstDispose).toHaveBeenCalledOnce()
    expect(secondDispose).toHaveBeenCalledOnce()
  })

  it('rejects invalid projection owners and invalidation ranges near the source', () => {
    const registry = new EditorDisplayProjectionRegistry()

    expect(() => registry.set(rowProjection('', 0, 0, 'row'))).toThrow(
      'Display projection owner is required',
    )
    expect(() =>
      registry.set({
        ...rowProjection('invalid-range', 0, 0, 'row'),
        invalidationRange: { kind: 'rows', startRow: 3, endRow: 2 },
      }),
    ).toThrow('Display projection row range end must be greater than or equal to start')
  })

  it('accepts nested fold projections and rejects crossing ones near ingestion', () => {
    const registry = new EditorDisplayProjectionRegistry()
    const outer = foldRange({ startIndex: 0, endIndex: 40, startLine: 0, endLine: 4 })
    const inner = foldRange({ startIndex: 8, endIndex: 20, startLine: 1, endLine: 2 })
    const crossing = foldRange({ startIndex: 30, endIndex: 60, startLine: 3, endLine: 5 })

    registry.set(foldProjection('editor.folds.syntax', [outer, inner]))
    expect(registry.get('folds', 'editor.folds.syntax')?.value).toEqual([outer, inner])

    expect(() => registry.set(foldProjection('editor.folds.syntax', [outer, crossing]))).toThrow(
      'Fold projection "editor.folds.syntax" contains crossing fold ranges',
    )
  })

  it('rejects invalid fold projections near ingestion', () => {
    const registry = new EditorDisplayProjectionRegistry()
    const fold = foldRange({ startIndex: 10, endIndex: 10, startLine: 1, endLine: 2 })

    expect(() => registry.set(foldProjection('editor.folds.syntax', [fold]))).toThrow(
      'Fold projection "editor.folds.syntax" contains an invalid fold range: Fold range endIndex must be greater than startIndex',
    )
  })

  it('orders non-conflicting fold providers deterministically', () => {
    const registry = new EditorDisplayProjectionRegistry()

    registry.set(
      foldProjection('test.folds.third', [foldRange({ startIndex: 40, endIndex: 50 })], {
        priority: 2,
      }),
    )
    registry.set(
      foldProjection('editor.folds.syntax', [foldRange({ startIndex: 0, endIndex: 10 })]),
    )
    registry.set(
      foldProjection('test.folds.semantic', [foldRange({ startIndex: 20, endIndex: 30 })]),
    )
    registry.set(
      foldProjection('test.folds.lastLayer', [foldRange({ startIndex: 60, endIndex: 70 })], {
        layer: 1,
      }),
    )

    expect(registry.values('folds').map((projection) => projection.owner)).toEqual([
      'editor.folds.syntax',
      'test.folds.semantic',
      'test.folds.third',
      'test.folds.lastLayer',
    ])
  })

  it('rejects crossing folds from multiple providers and preserves existing projections', () => {
    const registry = new EditorDisplayProjectionRegistry()
    const outer = foldRange({ startIndex: 0, endIndex: 40, startLine: 0, endLine: 4 })
    const adjacent = foldRange({ startIndex: 40, endIndex: 80, startLine: 4, endLine: 8 })
    const crossing = foldRange({ startIndex: 30, endIndex: 60, startLine: 3, endLine: 5 })

    registry.set(foldProjection('editor.folds.syntax', [outer]))
    registry.set(foldProjection('test.folds.semantic', [adjacent]))

    expect(() => registry.set(foldProjection('test.folds.outline', [crossing]))).toThrow(
      'Fold projections "editor.folds.syntax" and "test.folds.outline" contain crossing fold ranges',
    )
    expect(() => registry.replaceValue('folds', 'test.folds.semantic', [crossing])).toThrow(
      'Fold projections "editor.folds.syntax" and "test.folds.semantic" contain crossing fold ranges',
    )
    expect(registry.values('folds').map((projection) => projection.owner)).toEqual([
      'editor.folds.syntax',
      'test.folds.semantic',
    ])
    expect(registry.get('folds', 'test.folds.semantic')?.value).toEqual([adjacent])
  })

  it('accepts nested folds from multiple providers', () => {
    const registry = new EditorDisplayProjectionRegistry()
    const outer = foldRange({ startIndex: 0, endIndex: 40, startLine: 0, endLine: 4 })
    const inner = foldRange({ startIndex: 8, endIndex: 20, startLine: 1, endLine: 2 })

    registry.set(foldProjection('editor.folds.syntax', [outer]))
    registry.set(foldProjection('test.folds.outline', [inner]))

    expect(registry.values('folds').map((projection) => projection.owner)).toEqual([
      'editor.folds.syntax',
      'test.folds.outline',
    ])
  })
})

function rowProjection(
  owner: string,
  layer: number,
  priority: number,
  className: string,
  dispose?: () => void,
) {
  return {
    kind: 'rowDecorations' as const,
    owner,
    source,
    invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
    layer,
    priority,
    disposal: dispose
      ? { behavior: 'dispose' as const, disposable: { dispose } }
      : NO_DISPLAY_PROJECTION_DISPOSAL,
    value: new Map([[0, { className }]]),
  }
}

function foldProjection(
  owner: string,
  folds: readonly FoldRange[],
  options: { readonly layer?: number; readonly priority?: number } = {},
) {
  return {
    kind: 'folds' as const,
    owner,
    source,
    invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
    layer: options.layer ?? 0,
    priority: options.priority ?? 0,
    disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
    value: folds,
  }
}

function foldRange(overrides: Partial<FoldRange> = {}): FoldRange {
  return {
    startIndex: 0,
    endIndex: 10,
    startLine: 0,
    endLine: 1,
    type: 'block',
    languageId: 'typescript',
    ...overrides,
  }
}
