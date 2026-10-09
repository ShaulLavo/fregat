const connectivityErrorMessages = new Set([
  'failed to fetch',
  'fetch failed',
  'networkerror when attempting to fetch resource.',
  'load failed',
  'network error',
  'network request failed',
  'unable to connect. is the computer able to access the url?',
])

/** A request that never reached a server, bare or as the `value` an Eden fetch error wraps. */
export function isConnectivityError(input: unknown): boolean {
  if (input instanceof TypeError) return connectivityErrorMessages.has(input.message.toLowerCase())
  if (!(input instanceof Error) || !('value' in input)) return false
  const value = input.value
  return value instanceof TypeError && connectivityErrorMessages.has(value.message.toLowerCase())
}
