type ObservedMutation = {
  readonly key: string
  readonly status: string
}

/**
 * The newest mutation that failed and whose own step has not run again since.
 * Only a retry of the same key clears a failure: staging a file while a commit's
 * hooks run must not hide that the commit was then rejected.
 */
export function latestUnretriedFailure<T extends ObservedMutation>(
  mutations: readonly T[],
): T | null {
  const retried = new Set<string>()
  for (const mutation of mutations.toReversed()) {
    if (retried.has(mutation.key)) continue
    if (mutation.status === 'error') return mutation

    retried.add(mutation.key)
  }

  return null
}
