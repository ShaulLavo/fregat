import { describe, expect, it } from 'vitest'

import { FileTreeController } from '../model/controller'
import type { FileTreeDirectoryHandle } from '../model/public-types'

import { generatePaths, makeRng, naiveVisiblePaths } from '../../../test/factories/tree-paths'

// A literal list, never a random draw: a fuzz failure nobody can replay is
// noise. Every failure message below carries its seed and operation index, and
// re-running that seed alone reproduces the exact sequence.
const SEEDS = Array.from({ length: 50 }, (_value, index) => index + 1)
const OPERATIONS_PER_SEED = 30

describe('getVisibleRows survives random expand/collapse/search sequences', () => {
  for (const seed of SEEDS) {
    it(`agrees with the naive walk for seed ${seed}`, () => {
      runSeed(seed)
    })
  }
})

function runSeed(seed: number): void {
  const rng = makeRng(seed)
  const paths = generatePaths(rng, { fileCount: 40, maxChildren: 3, maxDepth: 4 })
  // Flattening (single-directory chains rendered as one row) is the tree's
  // default and is characterized separately in visible-rows.test.ts. Off here so
  // the oracle stays a plain depth-first walk.
  const controller = new FileTreeController({
    flattenEmptyDirectories: false,
    initialExpansion: 'closed',
    paths,
  })
  const directories = paths.filter((path) => path.endsWith('/'))

  checkVisibleRows(controller, paths, seed, -1, 'initial', rng)

  for (let index = 0; index < OPERATIONS_PER_SEED; index += 1) {
    const operation = applyOperation(controller, directories, rng)
    checkVisibleRows(controller, paths, seed, index, operation, rng)
  }
}

function applyOperation(
  controller: FileTreeController,
  directories: readonly string[],
  rng: () => number,
): string {
  const draw = rng()
  if (draw < 0.15) {
    controller.setSearch(null)

    return 'clear-search'
  }

  if (draw < 0.25) {
    controller.setSearch(`f${Math.floor(rng() * 10)}`)

    return 'search'
  }

  const directory = directories[Math.floor(rng() * directories.length)]
  if (directory === undefined) return 'noop'

  const item = directoryHandle(controller, directory)
  if (item === null) return `miss:${directory}`

  item.toggle()

  return `toggle:${directory}`
}

/**
 * The expansion flags are read back from the controller rather than tracked
 * here: search modes may expand matches on their own, and this suite is pinning
 * the visible-row bookkeeping, not a model of who expanded what. The visible
 * sequence itself is still computed independently, by the oracle.
 */
function expandedSet(controller: FileTreeController, paths: readonly string[]): Set<string> {
  const expanded = new Set<string>()
  for (const path of paths) {
    if (!path.endsWith('/')) continue

    const item = directoryHandle(controller, path)
    if (item === null) continue
    if (!item.isExpanded()) continue

    expanded.add(path)
  }

  return expanded
}

/** `in` narrows the handle union without a cast; files carry no `expand`. */
function directoryHandle(
  controller: FileTreeController,
  path: string,
): FileTreeDirectoryHandle | null {
  const item = controller.getItem(path)
  if (item === null) return null
  if (!('expand' in item)) return null

  return item
}

function checkVisibleRows(
  controller: FileTreeController,
  paths: readonly string[],
  seed: number,
  operationIndex: number,
  operation: string,
  rng: () => number,
): void {
  const where = `seed ${seed}, op ${operationIndex} (${operation})`
  const count = controller.getVisibleCount()
  const actual = controller.getVisibleRows(0, count - 1).map((row) => row.path)

  expect(actual.length, `${where}: getVisibleRows returned ${actual.length} of ${count} rows`).toBe(
    count,
  )
  checkWindows(controller, actual, rng, where)

  // A search filter has its own visibility rule; the oracle only models
  // expand/collapse, so full-sequence equality is asserted when no filter is on.
  if (controller.getSearchValue() !== '') return

  const expected = naiveVisiblePaths(paths, expandedSet(controller, paths))

  expect(actual, `${where}: first divergence at ${divergenceIndex(actual, expected)}`).toEqual(
    expected,
  )
}

function checkWindows(
  controller: FileTreeController,
  full: readonly string[],
  rng: () => number,
  where: string,
): void {
  const count = full.length
  if (count === 0) return

  for (let probe = 0; probe < 3; probe += 1) {
    const start = Math.floor(rng() * count)
    const end = Math.min(count - 1, start + Math.floor(rng() * 8))
    const window = controller.getVisibleRows(start, end).map((row) => row.path)

    expect(window, `${where}: window [${start}, ${end}] disagreed with the full sequence`).toEqual(
      full.slice(start, end + 1),
    )
  }
}

function divergenceIndex(actual: readonly string[], expected: readonly string[]): string {
  const length = Math.max(actual.length, expected.length)
  for (let index = 0; index < length; index += 1) {
    if (actual[index] === expected[index]) continue

    return `index ${index}: got ${String(actual[index])}, expected ${String(expected[index])}`
  }

  return 'no divergence'
}
