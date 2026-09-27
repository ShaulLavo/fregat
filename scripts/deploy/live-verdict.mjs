/** Only checks of the candidate decide its verdict; shared log diagnostics stay in the report. */
export function liveVerdict(report, preexisting) {
  const fresh = report.failures.filter((failure) => !preexisting.includes(failure))
  return { status: fresh.length === 0 ? 'passed' : 'failed', fresh }
}
