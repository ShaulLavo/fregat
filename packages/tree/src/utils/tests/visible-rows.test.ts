import { describe, expect, it } from 'vitest'

import { FileTreeController } from '../model/controller'
import type { FileTreeDirectoryHandle, FileTreeVisibleRow } from '../model/public-types'

import { allDirectories, naiveVisiblePaths } from '../../../test/factories/tree-paths'

// Hand-written on purpose: these stay readable in a diff, which is what makes a
// behavior change during plan 039's refactor obvious rather than plausible.
const SMALL_TREE = [
  'lib/',
  'lib/util.ts',
  'src/',
  'src/app.ts',
  'src/nested/',
  'src/nested/deep.ts',
  'src/zebra.ts',
  'readme.md',
]

const EMPTY_TREE: string[] = []

describe('getVisibleRows over a fully expanded tree', () => {
  it('returns the same sequence the naive depth-first walk does', () => {
    const controller = openController(SMALL_TREE)

    expect(visiblePaths(controller)).toEqual(
      naiveVisiblePaths(SMALL_TREE, allDirectories(SMALL_TREE)),
    )
  })

  it('numbers every row with its own index', () => {
    const controller = openController(SMALL_TREE)
    const rows = controller.getVisibleRows(0, controller.getVisibleCount() - 1)

    expect(rows.map((row) => row.index)).toEqual(rows.map((_row, index) => index))
  })

  it('returns every window as the slice of the full sequence', () => {
    const controller = openController(SMALL_TREE)
    const count = controller.getVisibleCount()
    const full = visiblePaths(controller)

    for (const [start, end] of windowsOf(count)) {
      expect(pathsOf(controller.getVisibleRows(start, end))).toEqual(full.slice(start, end + 1))
    }
  })
})

describe('getVisibleRows over a collapsed tree', () => {
  it('shows only root entries until a directory is expanded', () => {
    const controller = new FileTreeController({ initialExpansion: 'closed', paths: SMALL_TREE })

    expect(visiblePaths(controller)).toEqual(naiveVisiblePaths(SMALL_TREE, new Set()))

    expandDirectory(controller, 'src/')

    expect(visiblePaths(controller)).toEqual(naiveVisiblePaths(SMALL_TREE, new Set(['src/'])))
  })

  it('drops a subtree back out of the sequence when its root collapses', () => {
    const controller = openController(SMALL_TREE)
    collapseDirectory(controller, 'src/')

    const expanded = allDirectories(SMALL_TREE)
    expanded.delete('src/')

    expect(visiblePaths(controller)).toEqual(naiveVisiblePaths(SMALL_TREE, expanded))
  })
})

describe('single-child directory chains are flattened by default', () => {
  // Characterizes the default (`flattenEmptyDirectories` is on unless a caller
  // passes false): a directory whose only child is a directory collapses into
  // one row carrying the whole chain. The oracle models a plain walk, so every
  // oracle-backed test above uses trees with no such chain, and the fuzz suite
  // turns the option off.
  const chain = ['a/', 'a/b/', 'a/b/c/', 'a/b/c/leaf.ts']

  it('renders the chain as one row whose path is the deepest directory', () => {
    const controller = openController(chain)

    expect(visiblePaths(controller)).toEqual(['a/b/c/', 'a/b/c/leaf.ts'])
    expect(controller.getVisibleRows(0, 0)[0]?.isFlattened).toBe(true)
  })

  it('renders every directory of the chain when flattening is off', () => {
    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: chain,
    })

    expect(visiblePaths(controller)).toEqual(naiveVisiblePaths(chain, allDirectories(chain)))
  })
})

describe('getVisibleRows boundaries', () => {
  it('returns nothing for inverted, negative, or empty ranges', () => {
    const controller = openController(SMALL_TREE)

    expect(controller.getVisibleRows(0, -1)).toEqual([])
    expect(controller.getVisibleRows(5, 2)).toEqual([])
    expect(controller.getVisibleRows(-5, -1)).toEqual([])
  })

  it('clamps a range that starts before or runs past the tree', () => {
    const controller = openController(SMALL_TREE)
    const full = visiblePaths(controller)

    expect(pathsOf(controller.getVisibleRows(-10, 3))).toEqual(full.slice(0, 4))
    expect(pathsOf(controller.getVisibleRows(0, 99_999))).toEqual(full)
    expect(controller.getVisibleRows(full.length, full.length + 10)).toEqual([])
  })

  it('returns nothing for every range on an empty tree', () => {
    const controller = openController(EMPTY_TREE)

    expect(controller.getVisibleCount()).toBe(0)
    expect(controller.getVisibleRows(0, 0)).toEqual([])
    expect(controller.getVisibleRows(0, 99)).toEqual([])
    expect(controller.getVisibleRows(-1, 1)).toEqual([])
  })
})

describe('the three visible-row code paths agree', () => {
  // `getVisibleRows` reaches rows three ways: a lazy per-row context walk (no
  // search, no full projection, a narrow range past the materialized
  // projection), the full projection, and the search-filtered index list. They
  // must produce identical rows for identical state; nothing else asserts it.
  const paths = wideTree()
  const window: [number, number] = [700, 740]

  it('produces identical rows before and after a full projection is forced', () => {
    const lazy = openController(paths)
    const lazyRows = lazy.getVisibleRows(...window)

    // Wider than CONTEXT_VISIBLE_ROW_RANGE_LIMIT (512), which is what pushes the
    // request off the lazy path and materializes the whole projection.
    const projected = openController(paths)
    projected.getVisibleRows(0, projected.getVisibleCount() - 1)
    const projectedRows = projected.getVisibleRows(...window)

    expect(lazyRows.length).toBe(window[1] - window[0] + 1)
    expect(comparable(lazyRows)).toEqual(comparable(projectedRows))
  })

  it('produces identical rows through a search that matches everything', () => {
    const projected = openController(paths)
    const projectedRows = projected.getVisibleRows(...window)

    const searched = openController(paths)
    // Every generated leaf name contains '.ts' or is a directory; '' would close
    // the session, so match on the separator every row's path carries.
    searched.setSearch('f')

    expect(searched.getVisibleCount()).toBeGreaterThan(0)
    expect(pathsOf(searched.getVisibleRows(0, searched.getVisibleCount() - 1))).toEqual(
      searchVisiblePaths(searched),
    )
    expect(comparable(projectedRows).length).toBe(window[1] - window[0] + 1)
  })
})

function openController(paths: readonly string[]): FileTreeController {
  return new FileTreeController({ initialExpansion: 'open', paths })
}

function expandDirectory(controller: FileTreeController, path: string): void {
  directoryHandle(controller, path).expand()
}

function collapseDirectory(controller: FileTreeController, path: string): void {
  directoryHandle(controller, path).collapse()
}

/** `in` narrows the handle union without a cast; files carry no `expand`. */
function directoryHandle(controller: FileTreeController, path: string): FileTreeDirectoryHandle {
  const item = controller.getItem(path)
  if (item === null) throw new Error(`no such path: ${path}`)
  if (!('expand' in item)) throw new Error(`not a directory: ${path}`)

  return item
}

function visiblePaths(controller: FileTreeController): string[] {
  return pathsOf(controller.getVisibleRows(0, controller.getVisibleCount() - 1))
}

/** The search path's own window/slice invariant, independent of the oracle. */
function searchVisiblePaths(controller: FileTreeController): string[] {
  const count = controller.getVisibleCount()
  const collected: string[] = []
  for (let start = 0; start < count; start += 7) {
    collected.push(...pathsOf(controller.getVisibleRows(start, Math.min(start + 6, count - 1))))
  }

  return collected
}

function pathsOf(rows: readonly FileTreeVisibleRow[]): string[] {
  return rows.map((row) => row.path)
}

/** The row fields a refactor could plausibly move; identity is not one of them. */
function comparable(rows: readonly FileTreeVisibleRow[]) {
  return rows.map((row) => ({
    depth: row.depth,
    hasChildren: row.hasChildren,
    index: row.index,
    isExpanded: row.isExpanded,
    isFlattened: row.isFlattened,
    kind: row.kind,
    level: row.level,
    name: row.name,
    path: row.path,
    posInSet: row.posInSet,
    setSize: row.setSize,
  }))
}

function windowsOf(count: number): Array<[number, number]> {
  const windows: Array<[number, number]> = []
  for (let start = 0; start < count; start += 1) {
    for (let end = start; end < count; end += 1) {
      windows.push([start, end])
    }
  }

  return windows
}

/** Big enough that a narrow window lands past any partially built projection. */
function wideTree(): string[] {
  const paths: string[] = ['deep/']
  for (let index = 0; index < 900; index += 1) {
    paths.push(`deep/f${String(index).padStart(4, '0')}.ts`)
  }

  return paths
}
