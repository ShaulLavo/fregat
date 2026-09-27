import { describe, expect, it } from 'vitest'

import { FileTreeController } from '../model/FileTreeController'

const SEARCH_PATHS = [
  'README.md',
  'src/utils/stream.ts',
  'src/utils/worker-a.ts',
  'src/utils/worker-b.ts',
] as const

describe('search manual collapse overrides', () => {
  it('persists a collapse across query changes and clears it with the session', () => {
    const controller = createController()

    controller.setSearch('worker')
    expect(visiblePaths(controller)).toContain('src/utils/worker-a.ts')

    controller.toggleMountedDirectoryFromInput('src/utils/')
    expect(visiblePaths(controller)).toContain('src/utils/')
    expect(visiblePaths(controller)).not.toContain('src/utils/worker-a.ts')
    expect(controller.getSearchMatchingPaths()).toContain('src/utils/worker-a.ts')

    controller.setSearch('stream')
    expect(visiblePaths(controller)).toContain('src/utils/')
    expect(visiblePaths(controller)).not.toContain('src/utils/stream.ts')

    controller.setSearch(null)
    controller.setSearch('worker')
    expect(visiblePaths(controller)).toContain('src/utils/worker-a.ts')

    controller.destroy()
  })

  it('remaps collapses through add, move, batch, and remove mutations', () => {
    const controller = createController()

    controller.setSearch('worker')
    controller.toggleMountedDirectoryFromInput('src/utils/')

    controller.add('src/utils/worker-c.ts')
    expect(visiblePaths(controller)).not.toContain('src/utils/worker-c.ts')

    controller.move('src/', 'app/')
    expect(visiblePaths(controller)).toContain('app/utils/')
    expect(visiblePaths(controller)).not.toContain('app/utils/worker-a.ts')

    controller.batch([
      { from: 'app/', to: 'workspace/', type: 'move' },
      { path: 'workspace/utils/worker-d.ts', type: 'add' },
    ])
    expect(visiblePaths(controller)).toContain('workspace/utils/')
    expect(visiblePaths(controller)).not.toContain('workspace/utils/worker-d.ts')

    controller.remove('workspace/utils/', { recursive: true })
    controller.add('workspace/utils/worker-final.ts')
    expect(visiblePaths(controller)).toContain('workspace/utils/worker-final.ts')

    controller.destroy()
  })

  it('preserves a focused visible result across a search-time mutation', () => {
    const controller = createController()

    controller.setSearch('worker')
    controller.focusPath('src/utils/worker-b.ts')
    controller.add('src/utils/worker-0.ts')

    expect(controller.getFocusedPath()).toBe('src/utils/worker-b.ts')

    controller.destroy()
  })
})

function createController(): FileTreeController {
  return new FileTreeController({
    fileTreeSearchMode: 'hide-non-matches',
    flattenEmptyDirectories: false,
    initialExpansion: 'open',
    paths: SEARCH_PATHS,
  })
}

function visiblePaths(controller: FileTreeController): string[] {
  const count = controller.getVisibleCount()
  if (count === 0) return []

  return controller.getVisibleRows(0, count - 1).map((row) => row.path)
}
