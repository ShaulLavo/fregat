import { CliRenderEvents, MarkdownRenderable, Renderable, type CliRenderer } from '@opentui/core'

type SelectionSnapshot = NonNullable<ReturnType<typeof captureSelection>>
type PendingPaint = {
  readonly root: Renderable
  readonly selection: SelectionSnapshot
  readonly authority: ReturnType<CliRenderer['getSelection']>
  readonly restore: () => void
}

export function createMarkdownPaint(renderer: CliRenderer) {
  let pending: PendingPaint | null = null
  function cancel() {
    if (!pending) return
    renderer.off(CliRenderEvents.FRAME, pending.restore)
    pending = null
  }
  return {
    repaint(root: Renderable) {
      const previous = pending
      const selection =
        captureSelection(root, renderer) ??
        (previous?.root === root && renderer.getSelection() === previous.authority
          ? previous.selection
          : null)
      cancel()
      clearMarkdown(root)
      if (!selection) return
      const request: PendingPaint = {
        root,
        selection,
        authority: renderer.getSelection(),
        restore() {
          if (pending !== request) return
          pending = null
          if (root.isDestroyed || renderer.getSelection() !== request.authority) return
          restoreSelection(renderer, selection)
        },
      }
      pending = request
      renderer.once(CliRenderEvents.FRAME, request.restore)
    },
    dispose: cancel,
  }
}

function clearMarkdown(root: Renderable) {
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()
    if (!node) continue
    if (node instanceof MarkdownRenderable) {
      node.clearCache()
      continue
    }
    pending.push(...node.getChildren())
  }
}

function captureSelection(root: Renderable, renderer: CliRenderer) {
  const selection = renderer.getSelection()
  if (!selection) return null
  const anchor = Renderable.renderablesByNumber.get(
    renderer.hitTest(selection.anchor.x, selection.anchor.y),
  )
  const focus = Renderable.renderablesByNumber.get(
    renderer.hitTest(selection.focus.x, selection.focus.y),
  )
  if (!anchor || !focus || (!contains(root, anchor) && !contains(root, focus))) return null
  return {
    anchor: { id: anchor.id, x: selection.anchor.x - anchor.x, y: selection.anchor.y - anchor.y },
    focus: { id: focus.id, x: selection.focus.x - focus.x, y: selection.focus.y - focus.y },
    focusPosition: { x: selection.focus.x, y: selection.focus.y },
  }
}

function restoreSelection(renderer: CliRenderer, selection: SelectionSnapshot) {
  const anchor = renderer.root.findDescendantById(selection.anchor.id)
  const savedFocus = renderer.root.findDescendantById(selection.focus.id)
  const current = renderer.getSelection()
  if (!anchor || !savedFocus || !current) return
  const moved =
    current.focus.x !== selection.focusPosition.x || current.focus.y !== selection.focusPosition.y
  const x = moved ? current.focus.x : savedFocus.x + selection.focus.x
  const y = moved ? current.focus.y : savedFocus.y + selection.focus.y
  const focus = moved ? Renderable.renderablesByNumber.get(renderer.hitTest(x, y)) : savedFocus
  const dragging = current.isDragging
  const behavior = current.behavior
  renderer.startSelection(
    anchor,
    anchor.x + selection.anchor.x,
    anchor.y + selection.anchor.y,
    behavior,
  )
  for (let owner = anchor.parent; owner; owner = owner.parent) {
    renderer.updateSelection(focus, x, y, { finishDragging: !dragging })
    if (focus && contains(owner, focus)) break
  }
}

function contains(root: Renderable, node: Renderable) {
  for (let owner: Renderable | null = node; owner; owner = owner.parent) {
    if (owner === root) return true
  }
  return false
}
