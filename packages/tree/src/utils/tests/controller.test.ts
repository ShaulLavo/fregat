import { describe, expect, it, vi } from 'vitest'

import { FileTreeController } from '../model/FileTreeController'
import { computeFileTreeLayout } from '../model/layout'
import { renameFileTreePaths } from '../renameFileTreePaths'
import type { FileTreeVisibleRow } from '../model/publicTypes'

describe('FileTreeController', () => {
  it('tracks selection, search, drag/drop, and rename state', () => {
    const onDropComplete = vi.fn()
    const onRename = vi.fn()
    const controller = new FileTreeController({
      dragAndDrop: { onDropComplete },
      initialExpansion: 'open',
      paths: ['src/', 'src/a.ts', 'src/b.ts', 'lib/'],
      renaming: { onRename },
    })

    controller.getItem('src/a.ts')?.select()
    expect(controller.getSelectedPaths()).toEqual(['src/a.ts'])

    controller.openSearch('b.ts')
    expect(controller.getSearchMatchingPaths()).toEqual(['src/b.ts'])
    controller.focusNextSearchMatch()
    expect(controller.getFocusedPath()).toBe('src/b.ts')

    controller.closeSearch()
    expect(controller.startDrag('src/a.ts')).toBe(true)
    controller.setDragTarget({
      directoryPath: 'lib/',
      flattenedSegmentPath: null,
      hoveredPath: 'lib/',
      kind: 'directory',
    })
    expect(controller.completeDrag()).toBe(true)
    expect(controller.getItem('lib/a.ts')).not.toBeNull()
    expect(onDropComplete).toHaveBeenCalledWith({
      draggedPaths: ['src/a.ts'],
      operation: 'move',
      target: {
        directoryPath: 'lib/',
        flattenedSegmentPath: null,
        hoveredPath: 'lib/',
        kind: 'directory',
      },
    })

    expect(controller.startRenaming('lib/a.ts')).toBe(true)
    controller.getRenameView().setValue('renamed.ts')
    controller.getRenameView().commit()
    expect(controller.getItem('lib/renamed.ts')).not.toBeNull()
    expect(onRename).toHaveBeenCalledWith({
      destinationPath: 'lib/renamed.ts',
      isFolder: false,
      sourcePath: 'lib/a.ts',
    })
  })
})

describe('tree pure helpers', () => {
  it('computes virtualization windows with sticky occlusion', () => {
    const snapshot = computeFileTreeLayout(
      [
        row({ index: 0, path: 'src/', kind: 'directory', isExpanded: true }),
        row({ index: 1, path: 'src/a.ts', ancestorPaths: ['src/'] }),
        row({ index: 2, path: 'src/b.ts', ancestorPaths: ['src/'] }),
      ],
      {
        itemHeight: 24,
        overscan: 1,
        scrollTop: 20,
        stickyRows: [{ row: row({ index: 0, path: 'src/', kind: 'directory' }), top: 0 }],
        viewportHeight: 48,
      },
    )

    expect(snapshot.physical.totalHeight).toBe(72)
    expect(snapshot.sticky.height).toBe(24)
    expect(snapshot.visible).toEqual({ startIndex: 1, endIndex: 2 })
    expect(snapshot.occlusion.occludedCount).toBe(1)
  })

  it('renames folders and rejects path collisions', () => {
    expect(
      renameFileTreePaths({
        files: ['src/', 'src/a.ts', 'src/nested/', 'src/nested/b.ts'],
        isFolder: true,
        nextBasename: 'app',
        path: 'src',
      }),
    ).toEqual({
      destinationPath: 'app',
      isFolder: true,
      nextFiles: ['app/', 'app/a.ts', 'app/nested/', 'app/nested/b.ts'],
      sourcePath: 'src',
    })

    expect(
      renameFileTreePaths({
        files: ['src/a.ts', 'src/b.ts'],
        isFolder: false,
        nextBasename: 'b.ts',
        path: 'src/a.ts',
      }),
    ).toEqual({ error: '"src/b.ts" already exists.' })
  })
})

function row(overrides: Partial<FileTreeVisibleRow>): FileTreeVisibleRow {
  return {
    ancestorPaths: [],
    depth: 0,
    hasChildren: false,
    index: 0,
    isExpanded: false,
    isFlattened: false,
    isFocused: false,
    isSelected: false,
    kind: 'file',
    level: 0,
    name: overrides.path?.split('/').filter(Boolean).at(-1) ?? 'item',
    path: 'item.ts',
    posInSet: 0,
    setSize: 1,
    ...overrides,
  }
}
