/** Resolve registered CSS colors against the editor that supplies their theme variables. */
export function readColorAlpha(source: HTMLElement, color: string): number {
  const probe = source.ownerDocument.createElement('span')
  probe.style.cssText = 'display:none'
  probe.style.color = color
  source.append(probe)
  try {
    const resolved = source.ownerDocument.defaultView?.getComputedStyle(probe).color ?? color
    return colorAlpha(resolved)
  } finally {
    probe.remove()
  }
}

export function colorAlpha(color: string): number {
  if (color === 'transparent') return 0
  if (/^#[\da-f]{4}$/i.test(color)) return Number.parseInt(color[4]! + color[4]!, 16) / 255
  if (/^#[\da-f]{8}$/i.test(color)) return Number.parseInt(color.slice(7), 16) / 255
  let component: string | null = null
  if (color.includes('/')) component = color.slice(color.lastIndexOf('/') + 1, -1).trim()
  if (/^rgba?\(/.test(color) && color.split(',').length === 4)
    component = color.slice(color.lastIndexOf(',') + 1, -1).trim()
  if (component === null) return 1
  const alpha = Number.parseFloat(component) / (component.endsWith('%') ? 100 : 1)
  return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1
}
