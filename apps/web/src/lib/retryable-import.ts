/**
 * Caches one `import()`. A rejection clears the cache, so an error boundary's
 * retry asks the network again instead of replaying the failure.
 */
export function retryableImport<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
}
