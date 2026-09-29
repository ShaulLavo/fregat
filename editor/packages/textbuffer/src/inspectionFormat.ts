import {
  createPieceTreeInspectionSession,
  inspectionLimit,
  type PieceInspectionNode,
  type PieceTreeInspection,
  type PieceInspectionOptions,
} from './inspectionSession'
import type { PieceTableSnapshot } from './pieceTableTypes'

export function formatPieceInspectionNode(node: PieceInspectionNode): string {
  const p = node.piece
  const text = node.excerpt === null ? '' : ` text=${JSON.stringify(node.excerpt)}`
  const values = Object.entries(node.values)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')
  return `${node.edge} ${node.id} ${node.tree} ${p.visible ? 'visible' : 'tombstone'} buffer=${p.buffer} start=${p.start} length=${p.length} order=${p.order} lineBreaks=${p.lineBreaks} height=${node.height} left=${node.left ?? '-'} right=${node.right ?? '-'} ${values}${text}`
}

export function formatPieceTreeInspection(
  inspection: PieceTreeInspection,
  options: { readonly maxRows?: number } = {},
): string {
  const limit = inspectionLimit(options.maxRows, 200, 10000)
  const lines = [
    `piece tree length=${inspection.length} pieces=${inspection.pieceCount} nodes=${inspection.nodes.length}`,
  ]
  for (const node of inspection.nodes.slice(0, limit)) {
    lines.push(`${'  '.repeat(Math.min(node.depth, 40))}${formatPieceInspectionNode(node)}`)
  }
  if (inspection.nodes.length > limit)
    lines.push(`… ${inspection.nodes.length - limit} nodes omitted`)
  return lines.join('\n')
}

export function formatPieceTree(
  snapshot: PieceTableSnapshot,
  options: PieceInspectionOptions & { readonly maxRows?: number } = {},
): string {
  return formatPieceTreeInspection(
    createPieceTreeInspectionSession().inspect(snapshot, options),
    options,
  )
}
