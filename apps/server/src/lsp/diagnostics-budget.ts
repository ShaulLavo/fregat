/** Bounds discovery and every backend attempt with one deadline; late results are discarded. */
export async function withinDiagnosticsBudget<T>(
  timeoutMs: number,
  read: (remaining: () => number) => Promise<T | null>,
): Promise<T | null> {
  if (timeoutMs <= 0) return null
  const deadline = performance.now() + timeoutMs
  const remaining = () => Math.max(0, deadline - performance.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  try {
    const result = await Promise.race([read(remaining), expired])
    return remaining() > 0 ? result : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
