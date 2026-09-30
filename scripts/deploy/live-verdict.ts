/** Only checks of the candidate decide its verdict; shared log diagnostics stay in the report. */
export function liveVerdict<Report extends { readonly failures: readonly string[] }>(
  report: Report,
  preexisting: readonly string[],
): { status: 'passed' | 'failed'; fresh: string[] } {
  const fresh = report.failures.filter((failure) => !preexisting.includes(failure))
  return { status: fresh.length === 0 ? 'passed' : 'failed', fresh }
}
