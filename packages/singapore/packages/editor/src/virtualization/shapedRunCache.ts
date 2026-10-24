// Bound retained prefixes as well as their count: a single long run can exceed the whole budget.
const MAX_CODE_UNITS = 65_536
const MAX_RUNS = 512

/** A face owns its cache; changing or reloading a font drops it with the glyph metrics. */
export function cacheShapedRuns(measure: (text: string) => number): (text: string) => number {
  const widths = new Map<string, number>()
  let codeUnits = 0
  return (text) => {
    const known = widths.get(text)
    if (known !== undefined) return known
    const width = measure(text)
    if (text.length > MAX_CODE_UNITS) return width
    while (widths.size >= MAX_RUNS || codeUnits + text.length > MAX_CODE_UNITS) {
      const oldest = widths.keys().next().value!
      codeUnits -= oldest.length
      widths.delete(oldest)
    }
    widths.set(text, width)
    codeUnits += text.length
    return width
  }
}
