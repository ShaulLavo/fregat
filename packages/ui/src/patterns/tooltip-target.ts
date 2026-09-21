export type TooltipTarget = { element: HTMLElement; text: string }

const OWNER = '[data-tooltip], [data-slot="tooltip-trigger"]'

/**
 * The element whose hover text the shared layer should show, or null.
 *
 * Both selectors are resolved in one walk so the nearer one wins: a control
 * carrying its own tooltip sits inside rows that carry theirs, and only the
 * control should speak. Two popups over one control is the bug this prevents.
 */
export function tooltipTargetFor(node: EventTarget | null): TooltipTarget | null {
  if (!(node instanceof Element)) return null

  const owner = node.closest(OWNER)
  if (!(owner instanceof HTMLElement)) return null
  if (owner.dataset.slot === 'tooltip-trigger') return null

  const text = owner.dataset.tooltip?.trim()
  return text ? { element: owner, text } : null
}
