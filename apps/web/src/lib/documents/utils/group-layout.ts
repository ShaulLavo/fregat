import type { GroupAxis, GroupEdge, GroupNode } from '@/lib/documents/utils/group-types'

export const GROUP_MIN_WIDTH = 240
export const GROUP_MIN_HEIGHT = 160
export const GROUP_DIVIDER_SIZE = 4

export type GroupSize = { readonly width: number; readonly height: number }

export function groupSplitAxis(edge: GroupEdge): GroupAxis {
  return edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
}

export function minimumGroupSize(node: GroupNode): GroupSize {
  if (node.kind === 'group') return { width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT }

  const sizes = node.children.map((child) => minimumGroupSize(child.node))
  const dividers = (sizes.length - 1) * GROUP_DIVIDER_SIZE
  if (node.axis === 'horizontal') {
    return {
      width: sizes.reduce((total, size) => total + size.width, dividers),
      height: Math.max(...sizes.map((size) => size.height)),
    }
  }

  return {
    width: Math.max(...sizes.map((size) => size.width)),
    height: sizes.reduce((total, size) => total + size.height, dividers),
  }
}

export function canSplitGroup(bounds: GroupSize, edge: GroupEdge): boolean {
  if (groupSplitAxis(edge) === 'horizontal') {
    return (
      bounds.width >= GROUP_MIN_WIDTH * 2 + GROUP_DIVIDER_SIZE && bounds.height >= GROUP_MIN_HEIGHT
    )
  }

  return (
    bounds.height >= GROUP_MIN_HEIGHT * 2 + GROUP_DIVIDER_SIZE && bounds.width >= GROUP_MIN_WIDTH
  )
}
