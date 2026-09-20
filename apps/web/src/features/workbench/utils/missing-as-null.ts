/**
 * A 404 is an answer here, not a failure: the folder is gone, or it is not a
 * repository. Returned as data so it caches; an errored query with no data goes
 * back to pending on every refetch, which would blank the menu on each open.
 */
export async function missingAsNull<TValue>(request: Promise<TValue>): Promise<TValue | null> {
  try {
    return await request
  } catch (error) {
    if (errorStatus(error) === 404) return null
    throw error
  }
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object' || !('status' in error)) return null
  return error.status
}
