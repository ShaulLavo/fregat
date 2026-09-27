export function liveVerdict<Report extends { readonly failures: readonly string[] }>(
  report: Report,
  preexisting: readonly string[],
): { status: 'passed' | 'failed'; fresh: string[] }
