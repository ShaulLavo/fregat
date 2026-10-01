export type CaseScope = {
  readonly unit: string
  readonly memoryMiB: number
  readonly command: readonly string[]
  /** The heavy job's slice; a case that joins it counts against that job's cap and totals. */
  readonly slice?: string
}

/** The argv that runs one bench case in its own memory-capped user scope. */
export function caseScopeCommand(scope: CaseScope) {
  if (process.platform !== 'linux') return [...scope.command]
  return [
    'systemd-run',
    '--user',
    '--scope',
    '--quiet',
    `--unit=${scope.unit}`,
    ...(scope.slice ? [`--slice=${scope.slice}`] : []),
    '-p',
    `MemoryMax=${scope.memoryMiB}M`,
    '-p',
    'MemorySwapMax=0',
    ...scope.command,
  ]
}
