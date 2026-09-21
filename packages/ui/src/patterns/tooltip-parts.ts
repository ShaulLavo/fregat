export type TooltipTone = 'added' | 'default' | 'muted' | 'removed'

export type TooltipPart = { text: string; tone?: TooltipTone }

/**
 * Hover text for the shared layer. An attribute cannot carry a React node, so
 * content that needs more than one tone is encoded as parts — which is how a
 * diff count keeps its colour without giving the row its own tooltip.
 *
 * A plain string stays a plain string: most call sites want one tone.
 */
export function encodeTooltipParts(parts: readonly TooltipPart[]): string {
  const filled = parts.filter((part) => part.text !== '')
  if (filled.every((part) => part.tone === undefined)) {
    return filled.map((part) => part.text).join('')
  }

  return JSON.stringify(filled)
}

export function decodeTooltipParts(value: string): TooltipPart[] {
  if (!value.startsWith('[')) return [{ text: value }]

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return [{ text: value }]

    return parsed.filter(isTooltipPart)
  } catch {
    // A value that merely looks like JSON is still hover text.
    return [{ text: value }]
  }
}

/** The plain reading of the parts, for the accessible description. */
export function tooltipPartsText(parts: readonly TooltipPart[]): string {
  return parts.map((part) => part.text).join('')
}

function isTooltipPart(value: unknown): value is TooltipPart {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'text') === 'string'
  )
}
