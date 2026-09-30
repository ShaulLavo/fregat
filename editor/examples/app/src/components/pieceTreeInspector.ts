import {
  createPieceTreeInspectionSession,
  formatPieceInspectionNode,
  validatePieceTreeInvariants,
  type PieceInspectionNode,
  type PieceTableSnapshot,
  type PieceTreeComparison,
  type PieceTreeInspection,
  type PieceTreeValidation,
  type PieceNodeChange,
} from '@singapore-editor/core/debug'
import { el } from './dom.ts'

const ROW_LIMIT = 200

export function openPieceTreeInspector(
  readSnapshot: () => PieceTableSnapshot | null,
): HTMLDialogElement {
  const dialog = el('dialog', { 'aria-label': 'Piece tree inspector' })
  const title = el('h2')
  title.textContent = 'Piece tree inspector'
  const help = el('p')
  help.textContent =
    'Capture before, edit the document, then capture after. Text is hidden by default. Up to 200 rows are shown.'
  const controls = el('div')
  const beforeButton = button('Capture before')
  const afterButton = button('Capture after')
  const close = button('Close inspector')
  const side = el('select', { 'aria-label': 'Snapshot' })
  side.add(new Option('Before', 'before'))
  side.add(new Option('After', 'after'))
  const tree = el('select', { 'aria-label': 'Tree' })
  tree.add(new Option('Piece tree', 'pieces'))
  tree.add(new Option('Reverse index', 'reverse'))
  const excerpts = el('input', { type: 'checkbox' })
  const excerptLabel = el('label')
  excerptLabel.append(excerpts, ' Show text excerpts')
  controls.append(beforeButton, afterButton, side, tree, excerptLabel, close)
  const summary = el('p', { role: 'status', 'aria-live': 'polite' })
  const rows = el('select', { size: '12', 'aria-label': 'Inspection nodes' })
  const actions = el('div')
  const collapse = button('Collapse selected')
  const expand = button('Expand selected')
  const expandAll = button('Expand all')
  const lookup = button('Find in other tree')
  const issuesButton = button('Show issues')
  actions.append(collapse, expand, expandAll, lookup, issuesButton)
  const details = el('textarea', {
    readonly: '',
    rows: '10',
    cols: '90',
    'aria-label': 'Node details',
  })
  dialog.append(title, help, controls, summary, rows, actions, details)
  let session = createPieceTreeInspectionSession()
  let before: PieceTableSnapshot | null = null
  let after: PieceTableSnapshot | null = null
  let inspection: PieceTreeInspection | null = null
  let comparison: PieceTreeComparison | null = null
  let byId = new Map<string, PieceInspectionNode>()
  const inspections = new Map<string, PieceTreeInspection>()
  const validations = new Map<string, PieceTreeValidation>()
  const changes = new Map<string, PieceNodeChange>()
  const collapsed = new Set<string>()

  function selectNode(): void {
    const node = byId.get(rows.value)
    if (!node) return
    const change = changes.get(node.id)
    details.value = formatPieceInspectionNode(node)
    if (change)
      details.value += `\n${change.kind}: ${change.before ?? '-'} → ${change.after ?? '-'}\nChanged piece fields: ${change.fields.join(', ') || 'none'}`
  }

  function renderRows(selected?: string): void {
    rows.replaceChildren()
    let hiddenBelow = Infinity
    let visible = 0
    for (const node of inspection?.nodes ?? []) {
      if (node.tree !== tree.value || node.depth > hiddenBelow) continue
      hiddenBelow = collapsed.has(node.id) ? node.depth : Infinity
      visible++
      if (rows.length >= ROW_LIMIT) continue
      const marker = collapsed.has(node.id) ? '+' : '−'
      const change = changes.get(node.id)
      const text = `${'  '.repeat(Math.min(node.depth, 20))}${marker} ${node.edge} ${node.id} ${node.piece.visible ? 'visible' : 'tombstone'} ${node.piece.buffer}:${node.piece.start} (${node.piece.length}) ${change?.kind ?? ''}`
      rows.add(new Option(text, node.id))
    }
    if (selected) rows.value = selected
    if (rows.selectedIndex < 0 && rows.length) rows.selectedIndex = 0
    summary.textContent += ` Showing ${rows.length} of ${visible} expanded rows.`
    selectNode()
  }

  function refresh(): void {
    inspection = inspections.get(side.value) ?? null
    const validation = validations.get(side.value)
    if (!inspection || !validation) {
      inspection = null
      rows.replaceChildren()
      details.value = ''
      summary.textContent = 'Capture this snapshot to inspect it.'
      return
    }
    byId = new Map(inspection.nodes.map((node) => [node.id, node]))
    summary.textContent = `${validation.counts.nodes} pieces, ${validation.counts.invisible} tombstones, ${validation.issues.length} issues.`
    renderRows()
    if (validation.issues.length)
      details.value = JSON.stringify(validation.issues.slice(0, ROW_LIMIT), null, 2)
  }

  function inspectCaptures(): void {
    const options = { excerptLength: excerpts.checked ? 80 : 0 }
    comparison = before && after ? session.compare(before, after, options) : null
    inspections.clear()
    changes.clear()
    if (comparison) {
      inspections.set('before', comparison.before)
      inspections.set('after', comparison.after)
      indexChanges(comparison.changes, changes)
      refresh()
      return
    }
    if (before) inspections.set('before', session.inspect(before, options))
    if (after) inspections.set('after', session.inspect(after, options))
    refresh()
  }

  function capture(target: 'before' | 'after'): void {
    const snapshot = readSnapshot()
    if (!snapshot) {
      summary.textContent = 'Open an editable document first.'
      return
    }
    if (target === 'before') before = snapshot
    else after = snapshot
    side.value = target
    collapsed.clear()
    validations.set(target, validatePieceTreeInvariants(snapshot, session.label))
    inspectCaptures()
  }

  function findInOtherTree(): void {
    const selected = byId.get(rows.value)
    if (!selected) return
    const target = inspection?.nodes.find(
      (node) =>
        node.tree !== selected.tree &&
        node.piece.buffer === selected.piece.buffer &&
        node.piece.start === selected.piece.start,
    )
    if (!target) {
      // Original text has no reverse entry: the piece tree itself finds it.
      details.value = 'No matching buffer/start entry in the other tree.'
      return
    }
    tree.value = target.tree
    refresh()
    includeLookupRow(rows, target)
    rows.value = target.id
    selectNode()
  }

  beforeButton.onclick = () => capture('before')
  afterButton.onclick = () => capture('after')
  side.onchange = refresh
  tree.onchange = refresh
  excerpts.onchange = inspectCaptures
  rows.onchange = selectNode
  collapse.onclick = () => {
    const id = rows.value
    collapsed.add(id)
    refresh()
    rows.value = id
    selectNode()
  }
  expand.onclick = () => {
    const id = rows.value
    collapsed.delete(id)
    refresh()
    rows.value = id
    selectNode()
  }
  expandAll.onclick = () => {
    collapsed.clear()
    refresh()
  }
  lookup.onclick = findInOtherTree
  issuesButton.onclick = () => {
    details.value = JSON.stringify(
      validations.get(side.value)?.issues.slice(0, ROW_LIMIT) ?? [],
      null,
      2,
    )
  }
  close.onclick = () => dialog.close()
  dialog.addEventListener(
    'close',
    () => {
      before = null
      after = null
      inspection = null
      comparison = null
      byId.clear()
      inspections.clear()
      validations.clear()
      changes.clear()
      collapsed.clear()
      session = createPieceTreeInspectionSession()
      dialog.remove()
    },
    { once: true },
  )
  document.body.append(dialog)
  dialog.show()
  capture('before')
  return dialog
}

function button(text: string): HTMLButtonElement {
  const element = el('button', { type: 'button' })
  element.textContent = text
  return element
}

function indexChanges(
  entries: readonly PieceNodeChange[],
  target: Map<string, PieceNodeChange>,
): void {
  for (const entry of entries) {
    if (entry.before) target.set(entry.before, entry)
    if (entry.after) target.set(entry.after, entry)
  }
}

function includeLookupRow(rows: HTMLSelectElement, target: PieceInspectionNode): void {
  if ([...rows.options].some((option) => option.value === target.id)) return
  if (rows.length >= ROW_LIMIT) rows.remove(rows.length - 1)
  rows.add(new Option(`${target.id} ${target.piece.buffer}:${target.piece.start}`, target.id))
}
