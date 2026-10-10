/** CSS Text can move a tab to the following stop when the remaining gap is below 0.5ch. */
export function tabAdvance(visual: number, stop: number, minimum: number): number {
  const gap = stop - (visual % stop)
  return gap < minimum ? gap + stop : gap
}
