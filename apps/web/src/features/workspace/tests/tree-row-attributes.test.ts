import type { FileTreeVisibleRow } from '@workspace/tree'
import { describe, expect, it } from 'vitest'

import { computeTreeRowElementAttributes } from '@/features/workspace/utils/tree-row-attributes'

describe('tree row attributes', () => {
  it('projects row state into stable DOM attributes', () => {
    const attributes = computeTreeRowElementAttributes({
      ariaLabel: 'src / a.ts',
      domId: 'row-a',
      features: {
        contextMenuEnabled: true,
        gitLaneActive: true,
      },
      isParked: false,
      itemHeight: 24,
      mode: 'flow',
      row: row({
        ancestorPaths: ['src/'],
        index: 1,
        isFocused: true,
        isSelected: true,
        path: 'src/a.ts',
      }),
      state: {
        containsGitChange: true,
        effectiveGitStatus: 'modified',
        isContextHovered: false,
        isDragging: false,
        isFocusRinged: true,
        isLoading: true,
      },
      targetPath: 'src/a.ts',
    })

    expect(attributes.role).toBe('treeitem')
    expect(attributes.tabIndex).toBe(0)
    expect(attributes['data-item-git-status']).toBe('modified')
    expect(attributes['data-item-loading']).toBe('true')
    expect(attributes['data-item-drag-target']).toBeUndefined()
    expect(attributes['data-item-parent-path']).toBe('src/')
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
