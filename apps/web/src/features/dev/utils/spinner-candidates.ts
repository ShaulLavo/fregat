type RingSpec = { readonly radius: number; readonly dashes: number; readonly duty: number }

export type SpinnerCandidate = {
  readonly id: string
  readonly label: string
  readonly stroke: number
  readonly linecap: 'butt' | 'round'
  readonly rings: readonly { readonly radius: number; readonly dash: string }[]
}

const SIZES_PX = [12, 16, 24, 40] as const

function candidate(
  id: string,
  label: string,
  stroke: number,
  linecap: SpinnerCandidate['linecap'],
  rings: readonly RingSpec[],
): SpinnerCandidate {
  return { id, label, stroke, linecap, rings: rings.map(ringDash) }
}

// Whole dashes per circumference, so no ring shows a seam.
function ringDash({ radius, dashes, duty }: RingSpec) {
  const segment = (2 * Math.PI * radius) / dashes
  const on = segment * duty
  return { radius, dash: `${on.toFixed(2)} ${(segment - on).toFixed(2)}` }
}

export const CANDIDATE_SIZES = SIZES_PX

export const SPINNER_CANDIDATES: readonly SpinnerCandidate[] = [
  candidate('kokonut', 'A · kokonut exact (shipped now)', 1.067, 'butt', [
    { radius: 7.333, dashes: 5, duty: 0.31 },
    { radius: 6, dashes: 4, duty: 0.31 },
    { radius: 4.667, dashes: 3, duty: 0.31 },
    { radius: 3.333, dashes: 2, duty: 0.31 },
  ]),
  candidate('arcs', 'B · same stroke, 3 long arcs', 1.067, 'round', [
    { radius: 7, dashes: 2, duty: 0.4 },
    { radius: 5, dashes: 2, duty: 0.4 },
    { radius: 3, dashes: 1, duty: 0.45 },
  ]),
  candidate('kokonut-long', 'C · kokonut rings, longer dashes', 1.067, 'butt', [
    { radius: 7.333, dashes: 3, duty: 0.55 },
    { radius: 6, dashes: 3, duty: 0.55 },
    { radius: 4.667, dashes: 2, duty: 0.55 },
    { radius: 3.333, dashes: 1, duty: 0.6 },
  ]),
  candidate('medium', 'D · 1.5 stroke, 3 rings', 1.5, 'butt', [
    { radius: 7, dashes: 3, duty: 0.5 },
    { radius: 4.75, dashes: 2, duty: 0.5 },
    { radius: 2.5, dashes: 1, duty: 0.55 },
  ]),
]
