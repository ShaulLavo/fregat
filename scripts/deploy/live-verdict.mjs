/** Only checks of the candidate decide its verdict; shared log diagnostics stay in the report. */
export function liveVerdict(report, preexisting) {
  const fresh = report.failures.filter(
    (failure) =>
      failure.startsWith('console warnings:') ||
      failure.startsWith('terminal check:') ||
      !preexisting.includes(failure),
  )
  return { status: fresh.length === 0 ? 'passed' : 'failed', fresh }
}
