import { describe, expect, test } from 'vitest'

import {
  breadcrumbPathItems,
  sortPickerEntries,
  symbolChainAtCursor,
} from '@/features/workbench/utils/breadcrumbs'
import type { DocumentSymbol } from '@/lib/document-symbols'
import type { TreeEntry } from '@/lib/file-system-types'
import { filesystemPath } from '@/lib/documents/utils/identity'

function symbol(
  name: string,
  startLine: number,
  endLine: number,
  children: DocumentSymbol[] = [],
): DocumentSymbol {
  return {
    children,
    kind: 12,
    name,
    range: { end: { character: 1, line: endLine }, start: { character: 0, line: startLine } },
    selectionRange: {
      end: { character: name.length, line: startLine },
      start: { character: 0, line: startLine },
    },
  }
}

function entry(name: string, type: 'directory' | 'file'): TreeEntry {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name,
    path: filesystemPath(`/repo/${name}`),
    size: 0,
    type,
    version: name,
  }
}

describe('breadcrumbPathItems', () => {
  test('walks from the root to the file, the root itself not a crumb', () => {
    const items = breadcrumbPathItems('/repo', '/repo/src/app/main.ts')

    expect(items.map((item) => [item.kind, item.name, item.parentPath])).toEqual([
      ['folder', 'src', '/repo'],
      ['folder', 'app', '/repo/src'],
      ['file', 'main.ts', '/repo/src/app'],
    ])
  })

  test('a file at the root is a single crumb', () => {
    expect(breadcrumbPathItems('/repo', '/repo/README.md')).toEqual([
      { kind: 'file', name: 'README.md', parentPath: '/repo', path: '/repo/README.md' },
    ])
  })
})

describe('symbolChainAtCursor', () => {
  const outline = [
    symbol('top', 0, 2),
    symbol('Widget', 4, 20, [symbol('render', 6, 10), symbol('dispose', 12, 14)]),
  ]

  test('is the enclosing symbols, outermost first', () => {
    const chain = symbolChainAtCursor(outline, { column: 2, row: 8 })

    expect(chain.map((item) => item.name)).toEqual(['Widget', 'render'])
  })

  test('stops at the deepest symbol that still contains the caret', () => {
    expect(symbolChainAtCursor(outline, { column: 0, row: 16 }).map((item) => item.name)).toEqual([
      'Widget',
    ])
  })

  test('is empty between symbols and without a caret', () => {
    expect(symbolChainAtCursor(outline, { column: 0, row: 3 })).toEqual([])
    expect(symbolChainAtCursor(outline, null)).toEqual([])
  })
})

test('the picker lists folders before files, each in natural order', () => {
  const sorted = sortPickerEntries([
    entry('zeta.ts', 'file'),
    entry('file10.ts', 'file'),
    entry('lib', 'directory'),
    entry('file2.ts', 'file'),
    entry('app', 'directory'),
  ])

  expect(sorted.map((item) => item.name)).toEqual([
    'app',
    'lib',
    'file2.ts',
    'file10.ts',
    'zeta.ts',
  ])
})
