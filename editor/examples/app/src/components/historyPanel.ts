import type { Editor } from '@singapore-editor/core/editor'
import {
  createHistoryViewer,
  layoutHistoryGraph,
  type EditorHistoryGraphNode,
  type EditorTextBuffer,
  type HistoryComparison,
  type HistoryComparisonSide,
  type HistoryViewer,
} from '@singapore-editor/core/document'
import { createTextDiff, type DiffFile } from '@singapore-editor/diff'
import { materializePieceTableFullText } from '@singapore-editor/textbuffer'
import { el } from './dom.ts'

const COLUMN_WIDTH = 28
const LANE_HEIGHT = 18
const NODE_RADIUS = 4
// Past this a full-text diff is not a quick preview; say so instead of stalling.
const MAX_COMPARE_LENGTH = 2 * 1024 * 1024

export type HistoryPanel = {
  readonly element: HTMLDivElement
  setOpen(open: boolean): void
  /** Re-binds to whatever buffer the editor holds now. */
  sync(): void
  dispose(): void
}

export function createHistoryPanel(editor: Editor, now: () => number = Date.now): HistoryPanel {
  return new HistoryPanelController(editor, now)
}

class HistoryPanelController implements HistoryPanel {
  readonly element = el('div', { id: 'history', hidden: '' })
  private readonly graph = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  private readonly list = el('div', { id: 'history-list', role: 'listbox', tabindex: '0' })
  private readonly restoreButton = button('Restore')
  private readonly compareOutput = el('pre', { id: 'history-compare' })
  private readonly status = el('div', { id: 'history-status' })
  private viewer: HistoryViewer<DiffFile | 'too-large'> | null = null
  private boundBuffer: EditorTextBuffer | null = null
  private unsubscribe: (() => void) | null = null
  private open = false

  constructor(
    private readonly editor: Editor,
    private readonly now: () => number,
  ) {
    const header = el('div', { id: 'history-header' })
    const title = el('span')
    title.textContent = 'History'
    header.append(title, this.restoreButton)
    this.graph.setAttribute('id', 'history-graph')
    this.graph.setAttribute('aria-hidden', 'true')
    this.element.append(header, this.graph, this.list, this.status, this.compareOutput)
    this.list.setAttribute('aria-label', 'History states')
    this.restoreButton.onclick = () => this.restoreFocused()
    this.list.addEventListener('keydown', (event) => this.handleKey(event))
  }

  setOpen(open: boolean): void {
    this.open = open
    this.element.hidden = !open
    if (!open) return
    this.sync()
    this.render()
  }

  sync(): void {
    const buffer = this.editor.getBufferSession()?.buffer ?? null
    if (buffer === this.boundBuffer) return
    this.unbind()
    this.boundBuffer = buffer
    if (!buffer) {
      this.render()
      return
    }
    this.viewer = createHistoryViewer(buffer, { compare: compareStates })
    this.unsubscribe = this.viewer.subscribe(() => this.render())
    this.render()
  }

  dispose(): void {
    this.unbind()
  }

  private unbind(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.viewer?.dispose()
    this.viewer = null
    this.boundBuffer = null
  }

  private handleKey(event: KeyboardEvent): void {
    const viewer = this.viewer
    if (!viewer) return
    const handled = keyAction(event, viewer, () => this.restoreFocused())
    if (handled) event.preventDefault()
  }

  private restoreFocused(): void {
    const viewer = this.viewer
    const focused = viewer?.getState().focusedId
    if (!viewer || focused === null || focused === undefined) return
    viewer.restore(focused, this.editor.getBufferSession()?.view ?? null)
  }

  private render(): void {
    if (!this.open) return
    const viewer = this.viewer
    if (!viewer) {
      this.list.replaceChildren()
      this.graph.replaceChildren()
      this.status.textContent = 'No document'
      return
    }
    const state = viewer.getState()
    this.renderGraph(viewer)
    this.renderList(viewer)
    this.restoreButton.disabled =
      state.focusedId === null || state.focusedId === state.graph.currentId
    this.status.textContent = statusText(state.lostIds, state.graph.barrier)
    this.compareOutput.textContent = comparisonText(state.comparison)
  }

  private renderGraph(viewer: HistoryViewer<unknown>): void {
    const state = viewer.getState()
    const layout = layoutHistoryGraph(state.graph)
    const width = layout.columns * COLUMN_WIDTH + COLUMN_WIDTH
    const height = layout.lanes * LANE_HEIGHT + LANE_HEIGHT
    this.graph.setAttribute('viewBox', `0 0 ${width} ${height}`)
    this.graph.setAttribute('width', String(width))
    this.graph.setAttribute('height', String(height))
    const positions = new Map(
      layout.nodes.map((node) => [
        node.id,
        {
          x: node.column * COLUMN_WIDTH + COLUMN_WIDTH / 2,
          y: node.lane * LANE_HEIGHT + LANE_HEIGHT / 2,
        },
      ]),
    )
    const children: SVGElement[] = []
    for (const edge of layout.edges) {
      const from = positions.get(edge.fromId)!
      const to = positions.get(edge.toId)!
      const path = svg('path')
      path.setAttribute(
        'd',
        `M${from.x},${from.y} C${to.x},${from.y} ${from.x},${to.y} ${to.x},${to.y}`,
      )
      path.setAttribute('class', 'history-edge')
      children.push(path)
    }
    for (const node of state.graph.nodes) {
      const at = positions.get(node.id)!
      const circle = svg('circle')
      circle.setAttribute('cx', String(at.x))
      circle.setAttribute('cy', String(at.y))
      circle.setAttribute('r', String(NODE_RADIUS))
      circle.setAttribute('class', nodeClass(node, state.focusedId, state.selectedIds))
      circle.addEventListener('click', (event) => {
        if (event.shiftKey) viewer.toggleSelection(node.id)
        else viewer.focus(node.id)
      })
      children.push(circle)
    }
    this.graph.replaceChildren(...children)
  }

  private renderList(viewer: HistoryViewer<unknown>): void {
    const state = viewer.getState()
    const rows = state.graph.nodes.map((node) => {
      const row = el('div', { role: 'option', 'data-history-node': String(node.id) })
      row.className = nodeClass(node, state.focusedId, state.selectedIds)
      row.setAttribute('aria-selected', String(node.id === state.focusedId))
      row.setAttribute('aria-label', rowLabel(node, state.graph.currentId, this.now()))
      row.textContent = rowText(node, state.graph.currentId, this.now())
      row.onclick = (event) => {
        if (event.shiftKey) viewer.toggleSelection(node.id)
        else viewer.focus(node.id)
      }
      return row
    })
    this.list.replaceChildren(...rows)
    const focused = this.list.querySelector(`[data-history-node="${state.focusedId}"]`)
    focused?.scrollIntoView({ block: 'nearest' })
  }
}

function keyAction(
  event: KeyboardEvent,
  viewer: HistoryViewer<unknown>,
  restore: () => void,
): boolean {
  if (event.key === 'ArrowLeft') return viewer.focusParent()
  if (event.key === 'ArrowRight') return viewer.focusChild()
  if (event.key === 'ArrowUp') return viewer.focusPrevious()
  if (event.key === 'ArrowDown') return viewer.focusNext()
  if (event.key === 'Home') return viewer.focusCurrent()
  if (event.key === ' ') {
    const focused = viewer.getState().focusedId
    return focused === null ? false : viewer.toggleSelection(focused)
  }
  if (event.key === 'Escape') {
    viewer.clearSelection()
    return true
  }
  if (event.key === 'Enter') {
    restore()
    return true
  }
  return false
}

async function compareStates(
  left: HistoryComparisonSide,
  right: HistoryComparisonSide,
  signal: AbortSignal,
): Promise<DiffFile | 'too-large'> {
  if (left.snapshot.length > MAX_COMPARE_LENGTH || right.snapshot.length > MAX_COMPARE_LENGTH) {
    return 'too-large'
  }
  // @justification Yields once so a burst of selections settles before any text is materialized;
  // it only resolves a promise, and the abort signal is checked right after.
  await new Promise((resolve) => setTimeout(resolve, 0))
  signal.throwIfAborted()
  return createTextDiff({
    oldFile: { path: `state-${left.id}`, text: materializePieceTableFullText(left.snapshot) },
    newFile: { path: `state-${right.id}`, text: materializePieceTableFullText(right.snapshot) },
    contextLines: 2,
  })
}

function comparisonText(comparison: HistoryComparison<DiffFile | 'too-large'> | null): string {
  if (!comparison) return ''
  const header = `${comparison.left.id} → ${comparison.right.id}`
  if (comparison.status === 'pending') return `${header}: comparing…`
  if (comparison.status === 'failed') return `${header}: comparison failed`
  if (comparison.result === 'too-large') return `${header}: too large to compare here`
  const hunks = comparison.result?.hunks ?? []
  if (hunks.length === 0) return `${header}: identical text`
  const lines = hunks.flatMap((hunk) => [
    hunk.header,
    ...hunk.lines.map((line) => `${linePrefix(line.type)}${line.text}`),
  ])
  return `${header}\n${lines.join('\n')}`
}

function linePrefix(type: string): string {
  if (type === 'addition') return '+'
  if (type === 'deletion') return '-'
  return ' '
}

function statusText(
  lostIds: readonly number[],
  barrier: { readonly groupId: string; readonly segmentCount: number } | null,
): string {
  const parts: string[] = []
  if (lostIds.length > 0) parts.push(`State ${lostIds[0]} is no longer retained.`)
  if (barrier) parts.push(`Earlier history sits behind workspace edit ${barrier.groupId}.`)
  return parts.join(' ')
}

function nodeClass(
  node: EditorHistoryGraphNode,
  focusedId: number | null,
  selectedIds: readonly number[],
): string {
  const classes = ['history-node']
  if (node.isCurrent) classes.push('is-current')
  if (node.id === focusedId) classes.push('is-focused')
  if (selectedIds.includes(node.id)) classes.push('is-selected')
  return classes.join(' ')
}

function rowText(node: EditorHistoryGraphNode, currentId: number, now: number): string {
  const marker = node.id === currentId ? '●' : '○'
  return `${marker} ${node.id}  ${summary(node)}  ${relativeTime(node.committedAt, now)}`
}

function rowLabel(node: EditorHistoryGraphNode, currentId: number, now: number): string {
  const current = node.id === currentId ? ', current state' : ''
  return `State ${node.id}, ${summary(node)}, ${relativeTime(node.committedAt, now)}${current}`
}

function summary(node: EditorHistoryGraphNode): string {
  const transaction = node.transaction
  if (!transaction) return 'opened'
  const delta = transaction.edits.reduce(
    (total, edit) => total + edit.text.length - (edit.to - edit.from),
    0,
  )
  const sign = delta > 0 ? '+' : ''
  return `${transaction.metadata.intent} ${sign}${delta}`
}

function relativeTime(committedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - committedAt) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.round(minutes / 60)} h ago`
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag)
}

function button(label: string): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  return node
}
