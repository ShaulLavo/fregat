export type DigitRun = { digits: boolean; text: string }

/** Splits "1m 20s" into its number and unit runs so the numbers can roll. */
export function digitRuns(text: string): DigitRun[] {
  return (text.match(/\d+|\D+/gu) ?? []).map((run) => ({ digits: /^\d/u.test(run), text: run }))
}
