export function liveVerdict<
  Report extends {
    readonly failures: readonly string[]
    readonly release?: string
    readonly served?: { readonly release?: string }
  },
>(
  report: Report,
  preexisting: readonly string[],
): { release?: string; status: 'passed' | 'failed'; fresh: string[] }
