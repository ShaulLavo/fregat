import type {
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewSnapshot,
  EditorViewContributionUpdateKind,
} from '@singapore-editor/core/extensions'
import type { PresenceState } from './presence'
import type { PresencePluginOptions } from './presence-plugin'

type Caret = {
  readonly peer: PresenceState
  readonly index: number
  readonly x: number
  readonly y: number
  readonly height: number
  readonly labelBelow: boolean
  readonly labelOnLeft: boolean
}

export class PresenceView implements EditorViewContribution {
  readonly inputs = ['content', 'viewport', 'layout'] as const
  private root: HTMLDivElement | undefined
  private readonly highlights = new Map<string, { name: string; signature: string }>()
  private nextHighlight = 0
  private frame: number | undefined
  private labelDeadline: number | undefined
  private readonly activity = new Map<string, { signature: string; expires: number }>()
  private readonly unsubscribe: () => void
  private readonly detach: () => void

  constructor(
    private readonly context: EditorViewContributionContext,
    private readonly options: PresencePluginOptions,
  ) {
    this.unsubscribe = options.presence.subscribe(() => this.scheduleUpdate())
    this.detach = options.presence.attach()
  }

  update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (kind === 'clear' || snapshot.geometryCommitted === false) {
      this.clear()
      return
    }
    this.paint(snapshot, kind === 'document')
  }

  updateViewport(): void {
    this.paint()
  }

  dispose(): void {
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame)
    this.frame = undefined
    this.cancelLabelDeadline()
    this.activity.clear()
    this.unsubscribe()
    this.detach()
    this.clear()
  }

  private scheduleUpdate(): void {
    if (this.frame !== undefined) return
    // @justification Remote presence changes between editor updates; one frame coalesces its
    // notifications into a paint, and disposal cancels the pending frame.
    this.frame = window.requestAnimationFrame(() => {
      this.frame = undefined
      this.context.requestViewUpdate()
    })
  }

  private trackActivity(peers: readonly PresenceState[]): void {
    const active = new Set(peers.map((peer) => peer.peerSessionId))
    for (const peer of this.activity.keys()) {
      if (!active.has(peer)) this.activity.delete(peer)
    }
    for (const peer of peers) {
      const signature = JSON.stringify(peer.selections)
      if (this.activity.get(peer.peerSessionId)?.signature === signature) continue
      this.activity.set(peer.peerSessionId, {
        signature,
        expires: window.performance.now() + 2_000,
      })
    }
  }

  private scheduleLabels(): void {
    this.cancelLabelDeadline()
    const now = window.performance.now()
    let next = Infinity
    const carets = this.root?.querySelectorAll<HTMLElement>('[data-label-expires]') ?? []
    for (const caret of carets) {
      const expires = Number(caret.dataset.labelExpires)
      caret.dataset.idle = String(expires <= now)
      if (expires > now) next = Math.min(next, expires)
    }
    if (!Number.isFinite(next)) return
    // @justification Peer events cannot signal elapsed idle time; each view keeps one deadline
    // for the next visible name's idle transition, and clear or disposal cancels it.
    this.labelDeadline = window.setTimeout(
      () => {
        this.labelDeadline = undefined
        this.scheduleLabels()
      },
      Math.max(1, next - now),
    )
  }

  private cancelLabelDeadline(): void {
    if (this.labelDeadline === undefined) return
    window.clearTimeout(this.labelDeadline)
    this.labelDeadline = undefined
  }

  private paint(snapshot?: EditorViewSnapshot, forceHighlights = false): void {
    const peers = this.options.presence.states
    if (peers.length === 0) this.activity.clear()
    if (peers.length === 0 || !this.context.hasDocument()) {
      if (this.root || this.highlights.size > 0) this.clear()
      return
    }
    this.trackActivity(peers)
    const folds = (snapshot ?? this.context.getSnapshot()).foldMarkers
    const bounds = this.context.contentElement.getBoundingClientRect()
    const viewport = this.context.scrollElement.getBoundingClientRect()
    const carets: Caret[] = []
    const ranges = new Map<
      string,
      { readonly peer: PresenceState; readonly ranges: { start: number; end: number }[] }
    >()
    for (const peer of peers) {
      const selected: { start: number; end: number }[] = []
      peer.selections.forEach((selection, index) => {
        const anchor = this.options.resolver.resolveGap(selection.anchor)
        const head = this.options.resolver.resolveGap(selection.head)
        if (anchor === undefined || head === undefined) return
        if (anchor !== head)
          selected.push({ start: Math.min(anchor, head), end: Math.max(anchor, head) })
        // Mounted range geometry clamps hidden text to the fold edge.
        if (
          folds.some((fold) => fold.collapsed && head > fold.startOffset && head < fold.endOffset)
        )
          return
        const rect = this.context.getRangeClientRect(head, head)
        if (
          !rect ||
          rect.height === 0 ||
          rect.bottom <= viewport.top ||
          rect.top >= viewport.bottom ||
          rect.left < viewport.left ||
          rect.left >= viewport.right
        )
          return
        carets.push({
          peer,
          index,
          x: rect.left - bounds.left,
          y: rect.top - bounds.top,
          height: rect.height,
          labelBelow: rect.top - viewport.top < 18,
          labelOnLeft: viewport.right - rect.left < 164,
        })
      })
      ranges.set(peer.peerSessionId, { peer, ranges: selected })
    }
    // Read every caret before highlights or overlay writes can invalidate browser layout.
    for (const [peer, highlight] of this.highlights) {
      if (ranges.has(peer)) continue
      this.context.clearRangeHighlight(highlight.name)
      this.highlights.delete(peer)
    }
    for (const [peer, selection] of ranges) {
      const signature = JSON.stringify([selection.peer.colour, selection.ranges])
      const previous = this.highlights.get(peer)
      if (!forceHighlights && previous?.signature === signature) continue
      const name =
        previous?.name ?? `${this.context.highlightPrefix}-presence-${this.nextHighlight++}`
      this.context.setRangeHighlight(name, selection.ranges, {
        backgroundColor: `${selection.peer.colour}40`,
      })
      this.highlights.set(peer, { name, signature })
    }
    if (!this.root) {
      this.root = document.createElement('div')
      this.root.className = 'editor-remote-presence'
      this.root.setAttribute('aria-hidden', 'true')
      this.context.contentElement.append(this.root)
    }
    const fragment = document.createDocumentFragment()
    for (const caret of carets) fragment.append(this.caretElement(caret))
    this.root.replaceChildren(fragment)
    this.scheduleLabels()
  }

  private caretElement(caret: Caret): HTMLElement {
    const element = document.createElement('div')
    element.className = 'editor-remote-caret'
    element.dataset.peerSessionId = caret.peer.peerSessionId
    element.style.left = `${caret.x}px`
    element.style.top = `${caret.y}px`
    element.style.height = `${caret.height}px`
    element.style.backgroundColor = caret.peer.colour
    if (caret.index !== 0) return element
    element.dataset.labelExpires = String(this.activity.get(caret.peer.peerSessionId)!.expires)
    const label = document.createElement('span')
    label.className = 'editor-remote-name'
    label.textContent = caret.peer.displayName
    label.title = caret.peer.displayName
    label.style.top = caret.labelBelow ? `${caret.height}px` : '-18px'
    if (caret.labelOnLeft) {
      label.style.left = 'auto'
      label.style.right = '0'
    }
    label.style.backgroundColor = caret.peer.colour
    label.style.color = labelColour(caret.peer.colour)
    element.append(label)
    return element
  }

  private clear(): void {
    this.cancelLabelDeadline()
    for (const highlight of this.highlights.values())
      this.context.clearRangeHighlight(highlight.name)
    this.highlights.clear()
    this.root?.remove()
    this.root = undefined
  }
}

function labelColour(colour: string): string {
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(colour.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
