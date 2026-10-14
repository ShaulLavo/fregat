import type { TerminalOutputTiming } from 'ghostty-webgpu'

export type OutputTimingPart = { readonly label: string; readonly value: string }

/** The last output burst as short label/value pairs, in the order things happened. */
export function outputTimingParts(timing: TerminalOutputTiming): readonly OutputTimingPart[] {
  const parts: OutputTimingPart[] = []
  if (timing.inputAt !== undefined)
    parts.push({
      label: 'First output',
      value: milliseconds(timing.firstOutputAt - timing.inputAt),
    })
  parts.push({ label: 'Output', value: milliseconds(timing.lastOutputAt - timing.firstOutputAt) })
  if (timing.drawnAt === undefined) {
    parts.push({ label: 'Drawn', value: timing.hidden ? 'page hidden' : 'no change' })
    return parts
  }
  parts.push({ label: 'Drawn', value: `+${milliseconds(timing.drawnAt - timing.lastOutputAt)}` })
  if (timing.presentedAt !== undefined)
    parts.push({ label: 'Shown', value: `+${milliseconds(timing.presentedAt - timing.drawnAt)}` })
  return parts
}

function milliseconds(value: number) {
  const ms = Math.max(0, value)
  if (ms < 10) return `${ms.toFixed(1)} ms`

  return `${Math.round(ms)} ms`
}
